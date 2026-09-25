package main

import (
    "context"
    "sync"
)

// App is bound to the frontend: every exported method becomes
// window.go.main.App.<MethodName> in JavaScript.
type App struct {
    ctx context.Context

    mu    sync.Mutex // Wails calls bound methods on their own goroutines
    value int
}

func NewApp() *App {
    return &App{value: 42}
}

// startup runs once, when the Wails runtime is ready.
func (a *App) startup(ctx context.Context) {
    a.ctx = ctx
}

func clamp(value int) int {
    switch {
    case value < 0:
        return 0
    case value > 100:
        return 100
    default:
        return value
    }
}

// GetValue returns the stored value.
func (a *App) GetValue() int {
    a.mu.Lock()
    defer a.mu.Unlock()
    return a.value
}

// SetValue clamps, stores, and returns the stored value.
func (a *App) SetValue(value int) int {
    v := clamp(value)

    a.mu.Lock()
    a.value = v
    a.mu.Unlock()

    return v
}