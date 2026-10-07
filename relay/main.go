package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// Keep per-connection buffers small; events are streamed, not stored. The
	// history snapshot is capped on the desktop side; this is the hard upper bound.
	maxMessageBytes = 16 << 20
	writeWait       = 10 * time.Second
	pongWait        = 90 * time.Second
	pingPeriod      = 30 * time.Second
)

type server struct {
	cfg    config
	feishu *feishuClient
	hub    *hub

	mu     sync.Mutex
	tokens map[string]string // session token -> open_id
	// lastNotify throttles completion pings per session.
	lastNotify map[string]time.Time
}

// Cooldowns keep a burst of turns from turning into a burst of messages. An approval is repeated
// more slowly: it is the same question until the user answers it.
const (
	turnNotifyCooldown   = 20 * time.Second
	promptNotifyCooldown = 90 * time.Second
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Transcript frames are large JSON and phones are often on a slow link, so negotiate
	// permessage-deflate: the same history costs a fraction of the bytes on the wire.
	EnableCompression: true,
	// The H5 and the desktop authenticate via a Feishu-issued token and a
	// pre-shared pairing secret respectively, so Origin is not the guard here.
	CheckOrigin: func(*http.Request) bool { return true },
}

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	s := &server{
		cfg:        cfg,
		feishu:     newFeishuClient(cfg.FeishuAppID, cfg.FeishuAppSecret, cfg.FeishuBaseURL),
		hub:        newHub(),
		tokens:     map[string]string{},
		lastNotify: map[string]time.Time{},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/config", s.handleConfig)
	mux.HandleFunc("/api/login", s.handleLogin)
	mux.HandleFunc("/ws", s.handleWS)

	listener, err := listen(cfg.Addr)
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	if len(cfg.AllowedOpenIDs) == 0 {
		log.Printf("warning: PI_RELAY_OPEN_IDS is empty; every Feishu user that can open the app is allowed. Set it after first login.")
	}
	log.Printf("pi-relay listening on %s", cfg.Addr)
	httpServer := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	if err := httpServer.Serve(listener); err != nil {
		log.Fatalf("serve: %v", err)
	}
}

func listen(addr string) (net.Listener, error) {
	if strings.HasPrefix(addr, "unix:") {
		path := strings.TrimPrefix(addr, "unix:")
		_ = os.Remove(path)
		return net.Listen("unix", path)
	}
	return net.Listen("tcp", addr)
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":            true,
		"desktopOnline": s.hub.desktopOnline(),
	})
}

// handleConfig exposes the public app_id the H5 needs for Feishu JSAPI login.
// The app_secret never leaves the server.
func (s *server) handleConfig(w http.ResponseWriter, r *http.Request) {
	setCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"appId": s.cfg.FeishuAppID})
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	setCORS(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var request struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
		return
	}
	if strings.TrimSpace(request.Code) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "code is required"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	identity, err := s.feishu.exchangeCode(ctx, strings.TrimSpace(request.Code))
	if err != nil {
		log.Printf("login failed: %v", err)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "feishu authentication failed"})
		return
	}
	if len(s.cfg.AllowedOpenIDs) > 0 && !s.cfg.AllowedOpenIDs[identity.OpenID] {
		log.Printf("login denied open_id=%s name=%q", identity.OpenID, identity.Name)
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not allowed"})
		return
	}
	token, err := newToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "token generation failed"})
		return
	}
	s.mu.Lock()
	s.tokens[token] = identity.OpenID
	s.mu.Unlock()
	log.Printf("login ok open_id=%s name=%q", identity.OpenID, identity.Name)
	writeJSON(w, http.StatusOK, map[string]string{"token": token, "openId": identity.OpenID, "name": identity.Name})
}

func (s *server) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn.SetReadLimit(maxMessageBytes)
	if r.URL.Query().Get("role") == "desktop" {
		s.runDesktop(conn)
		return
	}
	openID, ok := s.lookupToken(r.URL.Query().Get("token"))
	if !ok {
		writeConn(conn, ErrorMessage{Type: TypeError, Code: "UNAUTHORIZED", Message: "invalid or missing token"})
		_ = conn.Close()
		return
	}
	s.runClient(conn, openID)
}

func (s *server) lookupToken(token string) (string, bool) {
	if token == "" {
		return "", false
	}
	if s.cfg.DevToken != "" && token == s.cfg.DevToken {
		return "dev", true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	openID, ok := s.tokens[token]
	return openID, ok
}

func (s *server) runDesktop(conn *websocket.Conn) {
	defer conn.Close()
	output := newOutbound()
	go writePump(conn, output.send)

	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		return
	}
	var register RegisterMessage
	if err := json.Unmarshal(raw, &register); err != nil || register.Type != TypeRegister {
		writeConn(conn, RegisteredMessage{Type: TypeRegistered, OK: false, Error: "register expected"})
		return
	}
	if subtle.ConstantTimeCompare([]byte(register.PairingSecret), []byte(s.cfg.PairingSecret)) != 1 {
		log.Printf("desktop register rejected: bad pairing secret")
		writeConn(conn, RegisteredMessage{Type: TypeRegistered, OK: false, Error: "invalid pairing secret"})
		return
	}
	log.Printf("desktop connected device=%q id=%s", register.DeviceName, register.DeviceID)
	s.hub.setDesktop(output)
	writeConn(conn, RegisteredMessage{Type: TypeRegistered, OK: true, DeviceID: register.DeviceID})
	defer s.hub.clearDesktop(output)

	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			log.Printf("desktop disconnected: %v", err)
			return
		}
		s.routeFromDesktop(raw)
	}
}

func (s *server) routeFromDesktop(raw []byte) {
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return
	}
	switch envelope.Type {
	case TypeEvent:
		var message EventMessage
		if json.Unmarshal(raw, &message) == nil && message.SessionID != "" {
			s.hub.broadcastEvent(message.SessionID, message.Event)
			s.notifyFromEvent(message.SessionID, message.Event)
		}
	case TypeHistory, TypeResult, TypeError, TypeSessions, TypeModels, TypeRunning:
		s.hub.broadcastToClients(json.RawMessage(raw))
	default:
		log.Printf("desktop sent unknown message type=%q", envelope.Type)
	}
}

// notifyTarget is who a completion ping goes to: the explicit setting, else the last user who
// signed in, else the first allowlisted id.
func (s *server) notifyTarget() string {
	if s.cfg.NotifyOpenID != "" {
		return s.cfg.NotifyOpenID
	}
	if id := s.hub.lastOpenID(); id != "" {
		return id
	}
	for id := range s.cfg.AllowedOpenIDs {
		return id
	}
	return ""
}

// notifyFromEvent pings the user on Feishu about something that needs their attention, but only when
// no client is watching the page: a long task finishing, or an approval that blocks the turn.
func (s *server) notifyFromEvent(sessionID string, event json.RawMessage) {
	if s.hub.clientCount() > 0 {
		return
	}
	text, cooldownKey, cooldown := "", "", time.Duration(0)
	if summary, isTurnEnd := turnEndSummary(event); isTurnEnd {
		text = "Pi Agent 完成了一个回合"
		if summary != "" {
			text += "：\n" + summary
		}
		cooldownKey, cooldown = "turn:"+sessionID, turnNotifyCooldown
	} else if prompt, isPrompt := uiPromptSummary(event); isPrompt {
		// An unanswered approval stalls the turn until it times out, so this one is worth more noise.
		text = "Pi Agent 需要你确认才能继续：\n" + prompt
		cooldownKey, cooldown = "prompt:"+sessionID, promptNotifyCooldown
	} else {
		return
	}
	target := s.notifyTarget()
	if target == "" {
		return
	}
	now := time.Now()
	s.mu.Lock()
	if last, seen := s.lastNotify[cooldownKey]; seen && now.Sub(last) < cooldown {
		s.mu.Unlock()
		return
	}
	s.lastNotify[cooldownKey] = now
	s.mu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		// A card carries a button, so one tap from the chat lands in that very conversation; without a
		// public URL there is nothing to link to and the plain text is all we can send.
		if s.cfg.PublicURL != "" {
			if err := s.feishu.sendCardMessage(ctx, target, s.notificationCard(text, sessionID)); err != nil {
				log.Printf("notify failed: %v", err)
			}
			return
		}
		if err := s.feishu.sendTextMessage(ctx, target, text); err != nil {
			log.Printf("notify failed: %v", err)
		}
	}()
}

// notificationCard is the message the user taps to get into the app, pointed at one conversation.
func (s *server) notificationCard(text, sessionID string) map[string]any {
	link := s.cfg.PublicURL
	if sessionID != "" {
		separator := "?"
		if strings.Contains(link, "?") {
			separator = "&"
		}
		link += separator + "session=" + url.QueryEscape(sessionID)
	}
	elements := []any{
		map[string]any{"tag": "div", "text": map[string]any{"tag": "lark_md", "content": text}},
		map[string]any{
			"tag": "action",
			"actions": []any{map[string]any{
				"tag":  "button",
				"type": "primary",
				"text": map[string]any{"tag": "plain_text", "content": "打开 Pi Agent"},
				"url":  link,
			}},
		},
	}
	return map[string]any{
		"config":   map[string]any{"wide_screen_mode": true},
		"header":   map[string]any{"template": "blue", "title": map[string]any{"tag": "plain_text", "content": "Pi Agent"}},
		"elements": elements,
	}
}

// uiPromptSummary describes a blocking extension UI prompt, and whether the event was one.
func uiPromptSummary(event json.RawMessage) (string, bool) {
	var envelope struct {
		Type    string `json:"type"`
		Method  string `json:"method"`
		Title   string `json:"title"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(event, &envelope); err != nil || envelope.Type != "extension_ui_request" {
		return "", false
	}
	switch envelope.Method {
	case "select", "confirm", "input", "editor":
	default:
		return "", false
	}
	text := strings.TrimSpace(envelope.Title)
	if text == "" {
		text = "需要你的确认"
	}
	if detail := summarizeText(envelope.Message); detail != "" {
		text += "：" + detail
	}
	return text, true
}

// turnEndSummary is the one-line gist of a finished turn, and whether the event was one at all.
func turnEndSummary(event json.RawMessage) (string, bool) {
	var envelope struct {
		Type     string `json:"type"`
		Messages []struct {
			Role    string `json:"role"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(event, &envelope); err != nil || envelope.Type != "agent_end" {
		return "", false
	}
	for i := len(envelope.Messages) - 1; i >= 0; i-- {
		message := envelope.Messages[i]
		if message.Role != "assistant" {
			continue
		}
		for _, block := range message.Content {
			if block.Type == "text" && strings.TrimSpace(block.Text) != "" {
				return summarizeText(block.Text), true
			}
		}
	}
	// A finished turn with nothing to quote is still worth telling the user about.
	return "", true
}

// summarizeText collapses a message into one short line.
func summarizeText(text string) string {
	cleaned := strings.Join(strings.Fields(text), " ")
	runes := []rune(cleaned)
	if len(runes) > 140 {
		return string(runes[:140]) + "…"
	}
	return cleaned
}

func (s *server) runClient(conn *websocket.Conn, openID string) {
	client := &clientState{outbound: *newOutbound(), openID: openID, subs: map[string]bool{}}
	go writePump(conn, client.send)
	s.hub.addClient(client)
	s.hub.rememberOpenID(openID)
	defer func() {
		s.hub.removeClient(client)
		_ = conn.Close()
	}()

	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		s.routeFromClient(client, raw)
	}
}

func (s *server) routeFromClient(client *clientState, raw []byte) {
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return
	}
	switch envelope.Type {
	case TypeSubscribe:
		var message SubscribeMessage
		if json.Unmarshal(raw, &message) == nil && message.SessionID != "" {
			client.subscribe(message.SessionID)
		}
	case TypePrompt, TypeAbort, TypeHistory, TypeSessions, TypeUIResponse, TypeModels, TypeSetModel, TypeRenameSession, TypeDeleteSession:
		if !s.hub.toDesktop(json.RawMessage(raw)) {
			var request struct {
				RequestID string `json:"requestId"`
			}
			_ = json.Unmarshal(raw, &request)
			client.push(ErrorMessage{Type: TypeError, Code: "DESKTOP_OFFLINE", Message: "the paired desktop is not connected"})
			if request.RequestID != "" {
				client.push(ResultMessage{Type: TypeResult, RequestID: request.RequestID, OK: false, Error: "desktop offline"})
			}
		}
	default:
		client.push(ErrorMessage{Type: TypeError, Code: "BAD_REQUEST", Message: "unknown message type"})
	}
}

func writePump(conn *websocket.Conn, send <-chan []byte) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	for {
		select {
		case message, ok := <-send:
			if !ok {
				_ = conn.Close()
				return
			}
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.TextMessage, message); err != nil {
				_ = conn.Close()
				return
			}
		case <-ticker.C:
			_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				_ = conn.Close()
				return
			}
		}
	}
}

func writeConn(conn *websocket.Conn, value any) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return
	}
	_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
	_ = conn.WriteMessage(websocket.TextMessage, encoded)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func setCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

func newToken() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}
