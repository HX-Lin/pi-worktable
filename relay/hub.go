package main

import (
	"encoding/json"
	"sync"
)

// outbound is the write side of one connection: a buffered queue drained by the
// connection's write pump. A slow consumer drops messages instead of growing
// memory, which keeps the relay's footprint flat.
type outbound struct {
	send chan []byte
}

func newOutbound() *outbound {
	return &outbound{send: make(chan []byte, 64)}
}

func (o *outbound) push(value any) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return
	}
	select {
	case o.send <- encoded:
	default:
		// Slow consumer: drop rather than buffer. Clients re-sync via history.
	}
}

// clientState is one connected H5 / mobile client.
type clientState struct {
	outbound
	openID string
	mu     sync.Mutex
	subs   map[string]bool
}

func (c *clientState) subscribe(sessionID string) {
	c.mu.Lock()
	c.subs[sessionID] = true
	c.mu.Unlock()
}

// wants reports whether this client should receive a session's events. A client
// that has not subscribed yet receives everything so a first connect is not silent.
func (c *clientState) wants(sessionID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.subs) == 0 {
		return true
	}
	return c.subs[sessionID]
}

// hub routes messages between the single paired desktop and all clients. All
// session data stays on the desktop; the hub only fans events out.
type hub struct {
	mu      sync.RWMutex
	desktop *outbound
	clients map[*clientState]struct{}
	// lastUser is the most recently authenticated open_id, so a notification has a target even
	// while nobody is connected.
	lastUser string
}

func newHub() *hub {
	return &hub{clients: map[*clientState]struct{}{}}
}

// clientCount reports how many phone or browser clients are connected: zero means nobody is
// watching the page, which is when a completion ping is worth sending.
func (h *hub) clientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// rememberOpenID records the last authenticated user.
func (h *hub) rememberOpenID(openID string) {
	if openID == "" {
		return
	}
	h.mu.Lock()
	h.lastUser = openID
	h.mu.Unlock()
}

// lastOpenID is the last authenticated user, or "" when nobody has signed in yet.
func (h *hub) lastOpenID() string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.lastUser
}

func (h *hub) setDesktop(peer *outbound) {
	h.mu.Lock()
	h.desktop = peer
	h.mu.Unlock()
	h.broadcastAll(PresenceMessage{Type: TypePresence, DesktopOnline: true})
}

func (h *hub) clearDesktop(peer *outbound) {
	h.mu.Lock()
	if h.desktop == peer {
		h.desktop = nil
	}
	h.mu.Unlock()
	h.broadcastAll(PresenceMessage{Type: TypePresence, DesktopOnline: false})
}

func (h *hub) desktopOnline() bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.desktop != nil
}

func (h *hub) addClient(client *clientState) {
	h.mu.Lock()
	h.clients[client] = struct{}{}
	online := h.desktop != nil
	h.mu.Unlock()
	client.push(PresenceMessage{Type: TypePresence, DesktopOnline: online})
}

func (h *hub) removeClient(client *clientState) {
	h.mu.Lock()
	delete(h.clients, client)
	h.mu.Unlock()
}

// toDesktop forwards a client request to the paired desktop. It reports whether
// a desktop was connected so the caller can answer with a clear error.
func (h *hub) toDesktop(value any) bool {
	h.mu.RLock()
	desktop := h.desktop
	h.mu.RUnlock()
	if desktop == nil {
		return false
	}
	desktop.push(value)
	return true
}

func (h *hub) broadcastEvent(sessionID string, event json.RawMessage) {
	message := EventMessage{Type: TypeEvent, SessionID: sessionID, Event: event}
	h.mu.RLock()
	clients := make([]*clientState, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
	}
	h.mu.RUnlock()
	for _, client := range clients {
		if client.wants(sessionID) {
			client.push(message)
		}
	}
}

// broadcastToClients sends a message (typically a history result) to every client.
func (h *hub) broadcastToClients(value any) {
	h.broadcastAll(value)
}

func (h *hub) broadcastAll(value any) {
	h.mu.RLock()
	clients := make([]*clientState, 0, len(h.clients))
	for client := range h.clients {
		clients = append(clients, client)
	}
	h.mu.RUnlock()
	for _, client := range clients {
		client.push(value)
	}
}
