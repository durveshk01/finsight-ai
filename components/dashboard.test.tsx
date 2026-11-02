import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Dashboard from "./dashboard";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("FinSight sign in", () => {
  it("offers demo access and an account creation path", () => {
    render(<Dashboard />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Explore the demo workspace/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(screen.getByRole("heading", { name: "Create your workspace" })).toBeInTheDocument();
    expect(screen.getByLabelText("Business name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account and workspace" })).toBeInTheDocument();
  });
});
