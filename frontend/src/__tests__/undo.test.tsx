// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useUndoable } from "../useUndoable";

describe("useUndoable", () => {
  it("undoes and redoes, and reset clears history", () => {
    const { result } = renderHook(() => useUndoable(1));
    act(() => result.current.set(2));
    expect(result.current.state).toBe(2);
    act(() => result.current.undo());
    expect(result.current.state).toBe(1);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.state).toBe(2);
    act(() => result.current.reset(9));
    expect(result.current.canUndo).toBe(false);
  });
  it("coalesces rapid edits into one step", () => {
    const { result } = renderHook(() => useUndoable("a"));
    act(() => { result.current.set("b"); result.current.set("c"); });
    act(() => result.current.undo());
    expect(result.current.state).toBe("a");
  });
});
