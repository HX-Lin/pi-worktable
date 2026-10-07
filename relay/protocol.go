package main

import "encoding/json"

// Wire protocol shared by the desktop bridge, the Feishu H5 client, and (later)
// the mobile app. Keep this file and src/shared/relay-protocol.ts in sync.
const (
	TypeRegister   = "register"
	TypeRegistered = "registered"
	TypePrompt     = "prompt"
	TypeAbort      = "abort"
	TypeSubscribe  = "subscribe"
	TypeEvent      = "event"
	TypeHistory    = "history"
	TypeResult     = "result"
	TypeError      = "error"
	TypePresence   = "presence"
	TypeSessions   = "sessions"
	TypeUIResponse = "ui_response"
	TypeModels     = "models"
	TypeSetModel   = "set_model"
	// Session management from the phone: rename and delete reuse the `result` reply.
	TypeRenameSession = "rename_session"
	TypeDeleteSession = "delete_session"
	// Desktop -> relay -> clients: which sessions have a turn in flight.
	TypeRunning = "running"
)

// Desktop -> relay: authenticate this connection as the paired desktop.
type RegisterMessage struct {
	Type          string `json:"type"`
	DeviceID      string `json:"deviceId"`
	DeviceName    string `json:"deviceName"`
	PairingSecret string `json:"pairingSecret"`
}

// Relay -> desktop: register result.
type RegisteredMessage struct {
	Type     string `json:"type"`
	OK       bool   `json:"ok"`
	DeviceID string `json:"deviceId,omitempty"`
	Error    string `json:"error,omitempty"`
}

// Client -> relay -> desktop: run a prompt in a session.
type PromptMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Text      string `json:"text"`
	RequestID string `json:"requestId,omitempty"`
}

// Client -> relay -> desktop: stop the running turn of a session.
type AbortMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId,omitempty"`
}

// Client -> relay: subscribe this connection to a session's event stream.
type SubscribeMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
}

// Desktop -> relay -> client: one AgentEvent for a session.
type EventMessage struct {
	Type      string          `json:"type"`
	SessionID string          `json:"sessionId"`
	Event     json.RawMessage `json:"event"`
}

// Client -> relay -> desktop (request); desktop -> relay -> client (result).
type HistoryRequestMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Cursor    *int   `json:"cursor,omitempty"`
	RequestID string `json:"requestId,omitempty"`
}

type HistoryResultMessage struct {
	Type      string            `json:"type"`
	SessionID string            `json:"sessionId"`
	Messages  []json.RawMessage `json:"messages"`
	RequestID string            `json:"requestId,omitempty"`
}

// Desktop -> relay -> client: acknowledgement of a client request.
type ResultMessage struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId,omitempty"`
	OK        bool   `json:"ok"`
	Error     string `json:"error,omitempty"`
	// SessionID echoes the session a prompt resolved to (useful when the client
	// omitted one and the desktop created or defaulted it).
	SessionID string `json:"sessionId,omitempty"`
}

// Either direction: a protocol or authorization failure.
type ErrorMessage struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Relay -> client: whether the paired desktop is currently connected.
type PresenceMessage struct {
	Type          string `json:"type"`
	DesktopOnline bool   `json:"desktopOnline"`
}

// Client -> relay -> desktop: list the sessions available on the desktop.
type SessionsRequestMessage struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId,omitempty"`
}

type SessionSummary struct {
	ID        string `json:"id"`
	Title     string `json:"title,omitempty"`
	Cwd       string `json:"cwd,omitempty"`
	Project   string `json:"project,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
}

// Desktop -> relay -> client: the session list.
type SessionsResultMessage struct {
	Type      string           `json:"type"`
	RequestID string           `json:"requestId,omitempty"`
	Sessions  []SessionSummary `json:"sessions"`
}

// Client -> relay -> desktop: answer an extension UI request (e.g. a Jev gate
// approval) surfaced in the web app. Exactly one of value/confirmed/cancelled is set.
type UIResponseMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	ID        string `json:"id"`
	Value     string `json:"value,omitempty"`
	Confirmed *bool  `json:"confirmed,omitempty"`
	Cancelled bool   `json:"cancelled,omitempty"`
	RequestID string `json:"requestId,omitempty"`
}

// Client -> relay -> desktop: list the selectable models and the session's current one.
type ModelsRequestMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	RequestID string `json:"requestId,omitempty"`
}

type ModelInfo struct {
	Provider string `json:"provider"`
	ID       string `json:"id"`
	Name     string `json:"name,omitempty"`
}

// Desktop -> relay -> client: the model list plus the current selection.
type ModelsResultMessage struct {
	Type      string      `json:"type"`
	SessionID string      `json:"sessionId"`
	RequestID string      `json:"requestId,omitempty"`
	Current   *ModelInfo  `json:"current,omitempty"`
	Models    []ModelInfo `json:"models"`
}

// Client -> relay -> desktop: switch the session's model.
type SetModelMessage struct {
	Type      string `json:"type"`
	SessionID string `json:"sessionId"`
	Provider  string `json:"provider"`
	ModelID   string `json:"modelId"`
	RequestID string `json:"requestId,omitempty"`
}
