import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
let connected = true;
vi.mock("../../app/sync", () => ({
  useSync: () => ({ connected, needsLogin: false, request }),
}));

import { AccountSecurityCard } from "../AccountSecurityCard";

const me = (totp: boolean) => ({
  user: { full_name: "Mario Rossi", email: "m@x.it", totp_enabled: totp, last_login_at: null },
  second_factor_required: false,
});

function serve(totp: boolean) {
  request.mockImplementation((_method: string, path: string) => {
    if (path === "/auth/me") return Promise.resolve(me(totp));
    if (path === "/auth/sessions")
      return Promise.resolve([
        {
          id: "a",
          last_used_at: "2026-01-01T10:00:00Z",
          ip_address: "1.2.3.4",
          user_agent: "Vyrion",
          current: true,
        },
        {
          id: "b",
          last_used_at: "2026-01-01T09:00:00Z",
          ip_address: null,
          user_agent: "Firefox/120",
          current: false,
        },
      ]);
    if (path.startsWith("/auth/login-history")) return Promise.resolve([]);
    if (path === "/auth/password/change") return Promise.resolve({ sessions_revoked: 1 });
    if (path === "/auth/2fa/setup")
      return Promise.resolve({ secret: "ABCDEFGHIJKLMNOP", otpauth_uri: "otpauth://x" });
    if (path === "/auth/2fa/enable")
      return Promise.resolve({ recovery_codes: ["aaaa-bbbb", "cccc-dddd"] });
    return Promise.resolve(undefined);
  });
}

describe("AccountSecurityCard", () => {
  beforeEach(() => {
    request.mockReset();
    connected = true;
  });

  it("renders nothing without a server link", () => {
    connected = false;
    const { container } = render(<AccountSecurityCard />);
    expect(container.textContent).toBe("");
  });

  it("survives a server that answers with something unexpected", async () => {
    request.mockResolvedValue({});
    render(<AccountSecurityCard />);
    expect(await screen.findByText("Il tuo account sul server")).toBeTruthy();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("2FA attiva")).toBeNull();
  });

  it("shows the profile and devices", async () => {
    serve(false);
    render(<AccountSecurityCard />);
    expect(await screen.findByText("Mario Rossi")).toBeTruthy();
    expect(screen.getByText("2FA non attiva")).toBeTruthy();
    expect(screen.getByText("App Vyrion ERP")).toBeTruthy();
    expect(screen.getByText("Firefox")).toBeTruthy();
  });

  it("refuses a short or mismatching password without calling the server", async () => {
    serve(false);
    render(<AccountSecurityCard />);
    await screen.findByText("Mario Rossi");
    fireEvent.click(screen.getByRole("button", { name: "Cambia password" }));
    fireEvent.change(screen.getByLabelText(/Password attuale/), { target: { value: "old" } });
    fireEvent.change(screen.getByLabelText(/Nuova password/), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva la password" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/almeno 12/);
    expect(request).not.toHaveBeenCalledWith("POST", "/auth/password/change", expect.anything());
  });

  it("changes the password and reports the revoked devices", async () => {
    serve(false);
    render(<AccountSecurityCard />);
    await screen.findByText("Mario Rossi");
    fireEvent.click(screen.getByRole("button", { name: "Cambia password" }));
    fireEvent.change(screen.getByLabelText(/Password attuale/), {
      target: { value: "old-password-1" },
    });
    fireEvent.change(screen.getByLabelText(/Nuova password/), {
      target: { value: "new-password-123" },
    });
    fireEvent.change(screen.getByLabelText(/Ripeti/), { target: { value: "new-password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Salva la password" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/scollegati 1/));
    expect(request).toHaveBeenCalledWith("POST", "/auth/password/change", {
      current_password: "old-password-1",
      new_password: "new-password-123",
    });
  });

  it("enables two-factor and shows the recovery codes once", async () => {
    serve(false);
    render(<AccountSecurityCard />);
    await screen.findByText("Mario Rossi");
    fireEvent.click(screen.getByRole("button", { name: "Attiva" }));
    expect(await screen.findByText("ABCD EFGH IJKL MNOP")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Codice a 6 cifre/), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Conferma e attiva" }));
    expect(await screen.findByText("aaaa-bbbb")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Li ho salvati" }));
    expect(screen.queryByText("aaaa-bbbb")).toBeNull();
  });
});
