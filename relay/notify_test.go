package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestSendTextMessagePostsToTheUsersConversation(t *testing.T) {
	var gotPath string
	var gotBody map[string]string
	mux := http.NewServeMux()
	mux.HandleFunc("/open-apis/auth/v3/app_access_token/internal", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "app_access_token": "app-token", "expire": 7200})
	})
	mux.HandleFunc("/open-apis/im/v1/messages", func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.String()
		if got := r.Header.Get("Authorization"); got != "Bearer app-token" {
			t.Errorf("unexpected authorization header: %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decode body: %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "msg": "ok"})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := newFeishuClient("id", "secret", server.URL)
	if err := client.sendTextMessage(context.Background(), "ou_abc", "完成了一个回合"); err != nil {
		t.Fatalf("sendTextMessage failed: %v", err)
	}
	if !strings.Contains(gotPath, "receive_id_type=open_id") {
		t.Fatalf("unexpected path: %q", gotPath)
	}
	if gotBody["receive_id"] != "ou_abc" || gotBody["msg_type"] != "text" {
		t.Fatalf("unexpected body: %#v", gotBody)
	}
	var content map[string]string
	if err := json.Unmarshal([]byte(gotBody["content"]), &content); err != nil {
		t.Fatalf("content is not json: %v", err)
	}
	if content["text"] != "完成了一个回合" {
		t.Fatalf("unexpected content: %#v", content)
	}
}

func TestSendTextMessageRejectsIncompleteArguments(t *testing.T) {
	client := newFeishuClient("id", "secret", "http://127.0.0.1:1")
	if err := client.sendTextMessage(context.Background(), "", "text"); err == nil {
		t.Fatal("expected an error for a missing open_id")
	}
	if err := client.sendTextMessage(context.Background(), "ou_abc", "   "); err == nil {
		t.Fatal("expected an error for empty text")
	}
}

func TestSendTextMessageSurfacesProviderErrors(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/open-apis/auth/v3/app_access_token/internal", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "app_access_token": "app-token", "expire": 7200})
	})
	mux.HandleFunc("/open-apis/im/v1/messages", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 230002, "msg": "no permission"})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	client := newFeishuClient("id", "secret", server.URL)
	err := client.sendTextMessage(context.Background(), "ou_abc", "hi")
	if err == nil || !strings.Contains(err.Error(), "230002") {
		t.Fatalf("expected the provider code in the error, got %v", err)
	}
}

func TestTurnEndSummaryQuotesTheLastAssistantText(t *testing.T) {
	event := json.RawMessage(`{"type":"agent_end","messages":[
		{"role":"user","content":[{"type":"text","text":"do it"}]},
		{"role":"assistant","content":[{"type":"thinking","text":"hmm"},{"type":"text","text":"Done:\n\n  fixed   the bug"}]}
	]}`)
	summary, ok := turnEndSummary(event)
	if !ok {
		t.Fatal("expected the event to be a turn end")
	}
	if summary != "Done: fixed the bug" {
		t.Fatalf("unexpected summary: %q", summary)
	}
}

func TestTurnEndSummaryIgnoresOtherEvents(t *testing.T) {
	for _, raw := range []string{`{"type":"agent_start"}`, `{"type":"turn_end"}`, `not json`} {
		if _, ok := turnEndSummary(json.RawMessage(raw)); ok {
			t.Fatalf("expected %s not to be a turn end", raw)
		}
	}
}

func TestTurnEndSummaryWithoutAssistantTextIsStillATurnEnd(t *testing.T) {
	summary, ok := turnEndSummary(json.RawMessage(`{"type":"agent_end","messages":[{"role":"user","content":[]}]}`))
	if !ok || summary != "" {
		t.Fatalf("expected an empty but valid summary, got %q %v", summary, ok)
	}
}

func TestSummarizeTextCollapsesAndTruncates(t *testing.T) {
	if got := summarizeText("a\n\n  b\tc "); got != "a b c" {
		t.Fatalf("unexpected collapse: %q", got)
	}
	long := summarizeText(strings.Repeat("字", 200))
	if len([]rune(long)) != 141 || !strings.HasSuffix(long, "…") {
		t.Fatalf("unexpected truncation: %d runes", len([]rune(long)))
	}
}

func TestNotifyTargetPrefersTheSettingThenTheLastUser(t *testing.T) {
	s := &server{cfg: config{AllowedOpenIDs: map[string]bool{"ou_allowed": true}}, hub: newHub()}
	if got := s.notifyTarget(); got != "ou_allowed" {
		t.Fatalf("expected the allowlisted id, got %q", got)
	}
	s.hub.rememberOpenID("ou_last")
	if got := s.notifyTarget(); got != "ou_last" {
		t.Fatalf("expected the last user, got %q", got)
	}
	s.cfg.NotifyOpenID = "ou_explicit"
	if got := s.notifyTarget(); got != "ou_explicit" {
		t.Fatalf("expected the explicit setting, got %q", got)
	}
}

func TestHubTracksWhoIsWatching(t *testing.T) {
	h := newHub()
	if h.clientCount() != 0 || h.lastOpenID() != "" {
		t.Fatal("a fresh hub has no clients and no user")
	}
	client := &clientState{outbound: *newOutbound(), openID: "ou_abc", subs: map[string]bool{}}
	h.addClient(client)
	h.rememberOpenID("ou_abc")
	if h.clientCount() != 1 || h.lastOpenID() != "ou_abc" {
		t.Fatalf("unexpected state: %d %q", h.clientCount(), h.lastOpenID())
	}
	h.removeClient(client)
	if h.clientCount() != 0 || h.lastOpenID() != "ou_abc" {
		t.Fatal("the last user must survive the client disconnecting")
	}
	h.rememberOpenID("")
	if h.lastOpenID() != "ou_abc" {
		t.Fatal("an empty id must not clear the remembered user")
	}
}

func TestNotifyTurnEndSkipsWhenSomebodyIsWatching(t *testing.T) {
	var sends int
	mux := http.NewServeMux()
	mux.HandleFunc("/open-apis/auth/v3/app_access_token/internal", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "app_access_token": "app-token", "expire": 7200})
	})
	mux.HandleFunc("/open-apis/im/v1/messages", func(w http.ResponseWriter, _ *http.Request) {
		sends++
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
	})
	api := httptest.NewServer(mux)
	defer api.Close()

	s := &server{
		cfg:        config{NotifyOpenID: "ou_abc", AllowedOpenIDs: map[string]bool{}},
		feishu:     newFeishuClient("id", "secret", api.URL),
		hub:        newHub(),
		lastNotify: map[string]time.Time{},
	}
	event := json.RawMessage(`{"type":"agent_end","messages":[]}`)

	// Nobody watching: one ping.
	s.notifyFromEvent("s1", event)
	deadline := time.Now().Add(2 * time.Second)
	for sends == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if sends != 1 {
		t.Fatalf("expected one ping, got %d", sends)
	}

	// The same session inside the cooldown stays quiet.
	s.notifyFromEvent("s1", event)
	time.Sleep(50 * time.Millisecond)
	if sends != 1 {
		t.Fatalf("the cooldown must suppress the second ping, got %d", sends)
	}

	// A client is watching now: no ping at all.
	client := &clientState{outbound: *newOutbound(), openID: "ou_abc", subs: map[string]bool{}}
	s.hub.addClient(client)
	s.notifyFromEvent("s2", event)
	time.Sleep(50 * time.Millisecond)
	if sends != 1 {
		t.Fatalf("a watching client must suppress the ping, got %d", sends)
	}
}

func TestUiPromptSummaryDescribesABlockingPrompt(t *testing.T) {
	event := json.RawMessage(`{"type":"extension_ui_request","method":"confirm","title":"Jev 闸门","message":"是否允许  \n\n rm -rf build"}`)
	text, ok := uiPromptSummary(event)
	if !ok {
		t.Fatal("expected a blocking prompt")
	}
	if !strings.Contains(text, "Jev 闸门") || !strings.Contains(text, "rm -rf build") {
		t.Fatalf("unexpected text: %q", text)
	}
}

func TestUiPromptSummaryIgnoresNonBlockingMethods(t *testing.T) {
	for _, raw := range []string{
		`{"type":"extension_ui_request","method":"notify","title":"hi"}`,
		`{"type":"agent_end","messages":[]}`,
		`not json`,
	} {
		if _, ok := uiPromptSummary(json.RawMessage(raw)); ok {
			t.Fatalf("expected %s not to be a blocking prompt", raw)
		}
	}
}

func TestUiPromptSummaryFallsBackToAGenericTitle(t *testing.T) {
	text, ok := uiPromptSummary(json.RawMessage(`{"type":"extension_ui_request","method":"select"}`))
	if !ok || text != "需要你的确认" {
		t.Fatalf("unexpected: %q %v", text, ok)
	}
}

func TestNotifyFromEventPingsAboutAnApproval(t *testing.T) {
	var texts []string
	var mu sync.Mutex
	mux := http.NewServeMux()
	mux.HandleFunc("/open-apis/auth/v3/app_access_token/internal", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "app_access_token": "app-token", "expire": 7200})
	})
	mux.HandleFunc("/open-apis/im/v1/messages", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		var content map[string]string
		_ = json.Unmarshal([]byte(body["content"]), &content)
		mu.Lock()
		texts = append(texts, content["text"])
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
	})
	api := httptest.NewServer(mux)
	defer api.Close()

	s := &server{
		// No public URL here on purpose: this case covers the plain-text fallback, the card path has its own test.
		cfg:        config{NotifyOpenID: "ou_abc", AllowedOpenIDs: map[string]bool{}},
		feishu:     newFeishuClient("id", "secret", api.URL),
		hub:        newHub(),
		lastNotify: map[string]time.Time{},
	}
	s.notifyFromEvent("s1", json.RawMessage(`{"type":"extension_ui_request","method":"confirm","title":"Jev 闸门"}`))
	deadline := time.Now().Add(2 * time.Second)
	for {
		mu.Lock()
		n := len(texts)
		mu.Unlock()
		if n > 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(texts) != 1 {
		t.Fatalf("expected one approval ping, got %d", len(texts))
	}
	if !strings.Contains(texts[0], "Jev 闸门") || !strings.Contains(texts[0], "需要你确认") {
		t.Fatalf("unexpected message: %q", texts[0])
	}
}

func TestNotificationCardLinksToTheConversation(t *testing.T) {
	s := &server{cfg: config{PublicURL: "https://pi.hxlin.fun/"}}
	card := s.notificationCard("完成了一个回合", "019fcc16-abc")
	elements, _ := card["elements"].([]any)
	if len(elements) != 2 {
		t.Fatalf("expected a text element and an action element, got %d", len(elements))
	}
	action, _ := elements[1].(map[string]any)
	actions, _ := action["actions"].([]any)
	if len(actions) != 1 {
		t.Fatalf("expected one button, got %d", len(actions))
	}
	button, _ := actions[0].(map[string]any)
	if got := button["url"]; got != "https://pi.hxlin.fun/?session=019fcc16-abc" {
		t.Fatalf("unexpected button url: %v", got)
	}
}

func TestNotificationCardKeepsAnExistingQueryString(t *testing.T) {
	s := &server{cfg: config{PublicURL: "https://pi.hxlin.fun/?from=feishu"}}
	card := s.notificationCard("hi", "s 1")
	action, _ := card["elements"].([]any)[1].(map[string]any)
	button, _ := action["actions"].([]any)[0].(map[string]any)
	if got := button["url"]; got != "https://pi.hxlin.fun/?from=feishu&session=s+1" {
		t.Fatalf("unexpected button url: %v", got)
	}
}

func TestNotifyFromEventSendsACardWhenALinkIsConfigured(t *testing.T) {
	var msgTypes []string
	var contents []string
	var mu sync.Mutex
	mux := http.NewServeMux()
	mux.HandleFunc("/open-apis/auth/v3/app_access_token/internal", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "app_access_token": "app-token", "expire": 7200})
	})
	mux.HandleFunc("/open-apis/im/v1/messages", func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		msgTypes = append(msgTypes, body["msg_type"])
		contents = append(contents, body["content"])
		mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
	})
	api := httptest.NewServer(mux)
	defer api.Close()

	s := &server{
		cfg:        config{NotifyOpenID: "ou_abc", AllowedOpenIDs: map[string]bool{}, PublicURL: "https://pi.hxlin.fun/"},
		feishu:     newFeishuClient("id", "secret", api.URL),
		hub:        newHub(),
		lastNotify: map[string]time.Time{},
	}
	s.notifyFromEvent("sess-1", json.RawMessage(`{"type":"agent_end","messages":[]}`))
	deadline := time.Now().Add(2 * time.Second)
	for {
		mu.Lock()
		n := len(msgTypes)
		mu.Unlock()
		if n > 0 || time.Now().After(deadline) {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(msgTypes) != 1 || msgTypes[0] != "interactive" {
		t.Fatalf("expected one interactive card, got %#v", msgTypes)
	}
	if !strings.Contains(contents[0], "sess-1") {
		t.Fatalf("the card must link to the session, got %s", contents[0])
	}
}
