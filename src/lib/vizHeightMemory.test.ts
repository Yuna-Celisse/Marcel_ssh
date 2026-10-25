// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIZ_HEIGHT_MEMORY_STORAGE_KEY,
  readVizHeight,
  rememberVizHeight,
  resetVizHeightMemoryForTest,
} from "./vizHeightMemory";

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetVizHeightMemoryForTest();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("vizHeightMemory", () => {
  it("returns null for an unknown key", () => {
    expect(readVizHeight("nope")).toBeNull();
  });

  it("persists to localStorage after the debounce and reloads from it", () => {
    rememberVizHeight("a", 321);
    expect(localStorage.getItem(VIZ_HEIGHT_MEMORY_STORAGE_KEY)).toBeNull();
    vi.advanceTimersByTime(700);
    expect(localStorage.getItem(VIZ_HEIGHT_MEMORY_STORAGE_KEY)).toContain("321");
    resetVizHeightMemoryForTest();
    expect(readVizHeight("a")).toBe(321);
  });

  it("ignores non-positive and non-finite heights", () => {
    rememberVizHeight("a", 0);
    rememberVizHeight("b", Number.NaN);
    rememberVizHeight("c", -5);
    expect(readVizHeight("a")).toBeNull();
    expect(readVizHeight("b")).toBeNull();
    expect(readVizHeight("c")).toBeNull();
  });

  it("evicts the least recently used entries beyond the cap", () => {
    for (let i = 0; i < 305; i++) rememberVizHeight(`k${i}`, 100 + i);
    expect(readVizHeight("k0")).toBeNull();
    expect(readVizHeight("k4")).toBeNull();
    expect(readVizHeight("k5")).toBe(105);
    expect(readVizHeight("k304")).toBe(404);
  });

  it("treats corrupted storage as empty without throwing", () => {
    localStorage.setItem(VIZ_HEIGHT_MEMORY_STORAGE_KEY, "{not json");
    expect(readVizHeight("a")).toBeNull();
    localStorage.setItem(VIZ_HEIGHT_MEMORY_STORAGE_KEY, JSON.stringify([["a", "x"], ["b", 50], 7]));
    resetVizHeightMemoryForTest();
    expect(readVizHeight("a")).toBeNull();
    expect(readVizHeight("b")).toBe(50);
  });
});
