package main

import (
	"encoding/json"
	"testing"
)

func drain(t *testing.T, output *outbound) []map[string]any {
	t.Helper()
	var messages []map[string]any
	for {
		select {
		case raw := <-output.send:
			var message map[string]any
			if err := json.Unmarshal(raw, &message); err != nil {
				t.Fatalf("decode outbound message: %v", err)
			}
			messages = append(messages, message)
		default:
			return messages
		}
	}
}

func TestHubForwardsClientRequestsToDesktop(t *testing.T) {
	h := newHub()
	desktop := newOutbound()
	h.setDesktop(desktop)
	_ = drain(t, desktop) // presence broadcast has no desktop peer

	if !h.toDesktop(PromptMessage{Type: TypePrompt, SessionID: "s1", Text: "hi"}) {
		t.Fatal("expected toDesktop to succeed while a desktop is connected")
	}
	messages := drain(t, desktop)
	if len(messages) != 1 || messages[0]["type"] != TypePrompt || messages[0]["text"] != "hi" {
		t.Fatalf("unexpected desktop messages: %#v", messages)
	}
}

func TestHubReportsOfflineDesktop(t *testing.T) {
	h := newHub()
	if h.toDesktop(PromptMessage{Type: TypePrompt, SessionID: "s1", Text: "hi"}) {
		t.Fatal("expected toDesktop to fail with no desktop connected")
	}
	if h.desktopOnline() {
		t.Fatal("expected desktopOnline to be false")
	}
}

func TestHubBroadcastsEventsToClients(t *testing.T) {
	h := newHub()
	client := &clientState{outbound: *newOutbound(), openID: "ou_a", subs: map[string]bool{}}
	h.addClient(client)
	presence := drain(t, &client.outbound)
	if len(presence) != 1 || presence[0]["type"] != TypePresence || presence[0]["desktopOnline"] != false {
		t.Fatalf("expected offline presence on join, got %#v", presence)
	}

	h.broadcastEvent("s1", json.RawMessage(`{"type":"delta","text":"x"}`))
	messages := drain(t, &client.outbound)
	if len(messages) != 1 || messages[0]["type"] != TypeEvent || messages[0]["sessionId"] != "s1" {
		t.Fatalf("unexpected event fan-out: %#v", messages)
	}
}

func TestHubFiltersEventsBySubscription(t *testing.T) {
	h := newHub()
	client := &clientState{outbound: *newOutbound(), openID: "ou_a", subs: map[string]bool{}}
	h.addClient(client)
	_ = drain(t, &client.outbound)

	client.subscribe("s2")
	h.broadcastEvent("s1", json.RawMessage(`{"type":"delta"}`))
	if messages := drain(t, &client.outbound); len(messages) != 0 {
		t.Fatalf("expected no events for an unsubscribed session, got %#v", messages)
	}
	h.broadcastEvent("s2", json.RawMessage(`{"type":"delta"}`))
	if messages := drain(t, &client.outbound); len(messages) != 1 {
		t.Fatalf("expected one event for the subscribed session, got %#v", messages)
	}
}

func TestHubPresenceFollowsDesktopLifecycle(t *testing.T) {
	h := newHub()
	client := &clientState{outbound: *newOutbound(), openID: "ou_a", subs: map[string]bool{}}
	h.addClient(client)
	_ = drain(t, &client.outbound)

	desktop := newOutbound()
	h.setDesktop(desktop)
	messages := drain(t, &client.outbound)
	if len(messages) != 1 || messages[0]["desktopOnline"] != true {
		t.Fatalf("expected online presence, got %#v", messages)
	}

	h.clearDesktop(desktop)
	messages = drain(t, &client.outbound)
	if len(messages) != 1 || messages[0]["desktopOnline"] != false {
		t.Fatalf("expected offline presence, got %#v", messages)
	}
}

func TestOutboundDropsWhenBufferFull(t *testing.T) {
	output := newOutbound()
	for i := 0; i < 1000; i++ {
		output.push(PromptMessage{Type: TypePrompt, Text: "x"})
	}
	if len(output.send) > cap(output.send) {
		t.Fatalf("buffer grew past capacity: len=%d cap=%d", len(output.send), cap(output.send))
	}
}
