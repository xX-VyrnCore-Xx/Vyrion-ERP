// @vitest-environment node
import { describe, expect, it } from "vitest";

import { LockedError } from "../../data/errors";
import { testWorkspace } from "../../test/workspace";
import { exportCalendar, fold, importCalendar, parseTime, readCalendar } from "../ics";
import { notifications } from "../insights";
import { billableTickets, billTicketHours, roundUp } from "../ticketBilling";

const clock = () => new Date("2026-06-15T10:00:00Z");

describe("reminders", () => {
  it("warns shortly before an appointment and from the reminder day for a task", async () => {
    const ws = await testWorkspace("ordinario", clock);
    const soon = await ws.create("appointment", {
      title: "Riunione cliente",
      starts_at: "2026-06-15T10:40:00Z",
      reminder_minutes: 60,
    });
    await ws.create("appointment", {
      title: "Troppo presto",
      starts_at: "2026-06-15T15:00:00Z",
      reminder_minutes: 30,
    });
    await ws.create("appointment", {
      title: "Senza promemoria",
      starts_at: "2026-06-15T10:30:00Z",
    });
    await ws.create("appointment", {
      title: "Già iniziato",
      starts_at: "2026-06-15T09:00:00Z",
      reminder_minutes: 120,
    });
    const task = await ws.create("task", {
      title: "Chiamare Rossi",
      status: "todo",
      remind_on: "2026-06-14",
    });
    await ws.create("task", { title: "Domani", status: "todo", remind_on: "2026-06-16" });
    await ws.create("task", { title: "Fatta", status: "done", remind_on: "2026-06-10" });

    const alerts = await notifications(ws.db, "2026-06-15", "2026-06-15T10:00:00.000Z");
    const titles = alerts.map((a) => a.title);
    expect(titles).toContain("Tra poco: Riunione cliente");
    expect(titles).toContain("Promemoria: Chiamare Rossi");
    expect(titles.some((t) => t.includes("Troppo presto") && t.startsWith("Tra poco"))).toBe(false);
    expect(titles.some((t) => t.includes("Senza promemoria") && t.startsWith("Tra poco"))).toBe(
      false,
    );
    expect(titles.some((t) => t.includes("Già iniziato") && t.startsWith("Tra poco"))).toBe(false);
    expect(titles).not.toContain("Promemoria: Domani");
    expect(titles).not.toContain("Promemoria: Fatta");
    expect(alerts.find((a) => a.title.startsWith("Tra poco"))?.id).toBe(soon.id);
    expect(alerts.find((a) => a.title === "Promemoria: Chiamare Rossi")?.id).toBe(task.id);
  });
});

describe("calendar (iCalendar)", () => {
  it("folds long lines at 75 octets without cutting a character", () => {
    const folded = fold(`SUMMARY:${"è".repeat(80)}`);
    for (const part of folded.split("\r\n"))
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"è".repeat(80)}`);
  });

  it("exports a valid calendar with events, alarms and tasks", async () => {
    const ws = await testWorkspace("ordinario", clock);
    await ws.create("appointment", {
      title: "Visita; con, virgole",
      starts_at: "2026-07-01T08:00:00Z",
      ends_at: "2026-07-01T09:30:00Z",
      location: "Milano",
      notes: "Riga 1\nRiga 2",
      reminder_minutes: 15,
    });
    await ws.create("task", {
      title: "Preparare offerta",
      status: "todo",
      priority: "high",
      due_date: "2026-07-03",
    });
    const ics = await exportCalendar(ws);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20260701T080000Z");
    expect(ics).toContain("DTEND:20260701T093000Z");
    expect(ics).toContain("SUMMARY:Visita\\; con\\, virgole");
    expect(ics).toContain("DESCRIPTION:Riga 1\\nRiga 2");
    expect(ics).toContain("TRIGGER:-PT15M");
    expect(ics).toContain("BEGIN:VTODO");
    expect(ics).toContain("DUE;VALUE=DATE:20260703");
    expect(ics).toContain("PRIORITY:1");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });

  it("round-trips: importing our own export changes nothing", async () => {
    const ws = await testWorkspace("ordinario", clock);
    await ws.create("appointment", {
      title: "A",
      starts_at: "2026-07-01T08:00:00Z",
      ends_at: "2026-07-01T09:00:00Z",
      location: "Roma",
      notes: "n",
    });
    const ics = await exportCalendar(ws, { tasks: false });
    expect(await importCalendar(ws, ics)).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect((await ws.list("appointment", {})).rows).toHaveLength(1);
  });

  it("reads time zones, whole days, floating times and ignores tasks and alarms", () => {
    const text = [
      "BEGIN:VCALENDAR",
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Rome",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:rome-1",
      "DTSTART;TZID=Europe/Rome:20260715T100000",
      "DTEND;TZID=Europe/Rome:20260715T113000",
      "SUMMARY:Estate a Roma",
      "RRULE:FREQ=WEEKLY",
      "BEGIN:VALARM",
      "TRIGGER:-PT10M",
      "END:VALARM",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:winter-1",
      "DTSTART;TZID=Europe/Rome:20261215T100000",
      "SUMMARY:Inverno",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:allday-1",
      "DTSTART;VALUE=DATE:20260801",
      "DTEND;VALUE=DATE:20260803",
      "SUMMARY:Ferie\\, mare",
      "END:VEVENT",
      "BEGIN:VTODO",
      "SUMMARY:Cosa",
      "END:VTODO",
      "END:VCALENDAR",
    ].join("\r\n");
    const read = readCalendar(text);
    expect(read.ignored).toBe(1);
    expect(read.events.map((e) => [e.title, e.startsAt])).toEqual([
      ["Estate a Roma", "2026-07-15T08:00:00.000Z"], // CEST is UTC+2
      ["Inverno", "2026-12-15T09:00:00.000Z"], // CET is UTC+1
      ["Ferie, mare", expect.stringMatching(/^2026-0(7-31|8-01)T/)], // local midnight of 1 Aug
    ]);
    expect(read.events[0]).toMatchObject({ endsAt: "2026-07-15T09:30:00.000Z", recurring: true });
    // an all-day event ends at the end of its last day, not the next morning
    const allDay = read.events[2];
    expect(new Date(allDay?.endsAt ?? "").getDate()).toBe(2);
    expect(parseTime({ name: "DTSTART", params: {}, value: "20260701T080000Z" })?.instant).toBe(
      "2026-07-01T08:00:00.000Z",
    );
    expect(parseTime({ name: "DTSTART", params: {}, value: "garbage" })).toBeNull();
  });

  it("imports foreign events once and updates them when the file changes", async () => {
    const ws = await testWorkspace("ordinario", clock);
    const file = (title: string) =>
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:ext-42@calendar.example",
        "DTSTART:20260901T090000Z",
        `SUMMARY:${title}`,
        "RRULE:FREQ=DAILY",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");
    expect(await importCalendar(ws, file("Prima"))).toMatchObject({ created: 1, recurring: 1 });
    expect(await importCalendar(ws, file("Prima"))).toMatchObject({ created: 0, unchanged: 1 });
    expect(await importCalendar(ws, file("Rinominata"))).toMatchObject({ created: 0, updated: 1 });
    const rows = (await ws.list("appointment", {})).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["title"]).toBe("Rinominata");
  });
});

describe("billing ticket hours", () => {
  async function withTickets() {
    const ws = await testWorkspace("ordinario", clock);
    const customer = await ws.create("party", {
      name: "Rossi Srl",
      kind: "customer",
      hourly_rate: 6000,
    });
    const t1 = await ws.create("ticket", {
      party_id: customer.id,
      subject: "Stampante",
      status: "open",
    });
    const t2 = await ws.create("ticket", {
      party_id: customer.id,
      subject: "Rete",
      status: "open",
    });
    await ws.create("ticket_intervention", {
      ticket_id: t1.id,
      performed_on: "2026-06-01",
      minutes: 40,
    });
    await ws.create("ticket_intervention", {
      ticket_id: t1.id,
      performed_on: "2026-06-03",
      minutes: 35,
    });
    await ws.create("ticket_intervention", {
      ticket_id: t2.id,
      performed_on: "2026-06-05",
      minutes: 90,
    });
    return { ws, customer, t1, t2 };
  }

  it("lists what is billable with the customer's rate", async () => {
    const { ws, customer } = await withTickets();
    const list = await billableTickets(ws);
    expect(list.map((t) => [t.subject, t.minutes, t.hourlyRate])).toEqual([
      ["Stampante", 75, 6000],
      ["Rete", 90, 6000],
    ]);
    expect(list.every((t) => t.partyId === customer.id)).toBe(true);
  });

  it("creates a draft invoice in hours, locks the interventions and refuses to bill twice", async () => {
    const { ws, customer, t1 } = await withTickets();
    const invoice = await billTicketHours(ws, {
      partyId: customer.id,
      rate: 6000,
      roundMinutes: 15,
    });
    expect(invoice["status"]).toBe("draft");
    const lines = (
      await ws.list("document_line", { filters: { document_id: invoice.id }, limit: 10 })
    ).rows;
    // 75 min -> 1,25 h (already a quarter-hour multiple); 90 min -> 1,5 h
    expect(lines.map((l) => [l["quantity"], l["unit"], l["unit_price"]])).toEqual([
      [1.25, "h", 6000],
      [1.5, "h", 6000],
    ]);
    expect(String(lines[0]?.["description"])).toContain("Stampante");
    expect(invoice["net_total"]).toBe(Math.round(1.25 * 6000) + Math.round(1.5 * 6000));
    expect(await billableTickets(ws)).toEqual([]);
    await expect(billTicketHours(ws, { partyId: customer.id, rate: 6000 })).rejects.toThrow(
      /Non ci sono ore/,
    );

    // a billed intervention cannot be edited or deleted, but hours added later are billable
    const [first] = (
      await ws.list("ticket_intervention", { filters: { ticket_id: t1.id }, limit: 5 })
    ).rows;
    await expect(
      ws.update("ticket_intervention", first?.id ?? "", { minutes: 5 }),
    ).rejects.toBeInstanceOf(LockedError);
    await expect(ws.remove("ticket_intervention", first?.id ?? "")).rejects.toBeInstanceOf(
      LockedError,
    );
    await ws.create("ticket_intervention", {
      ticket_id: t1.id,
      performed_on: "2026-06-10",
      minutes: 20,
    });
    expect((await billableTickets(ws)).map((t) => t.minutes)).toEqual([20]);
  });

  it("frees the hours again when the draft invoice is deleted", async () => {
    const { ws, customer } = await withTickets();
    const invoice = await billTicketHours(ws, { partyId: customer.id, rate: 6000 });
    expect(await billableTickets(ws)).toEqual([]);
    await ws.remove("document", invoice.id);
    expect((await billableTickets(ws)).reduce((s, t) => s + t.minutes, 0)).toBe(165);
  });

  it("needs a rate and rounds up in steps", async () => {
    const { ws, customer } = await withTickets();
    await expect(billTicketHours(ws, { partyId: customer.id, rate: 0 })).rejects.toThrow(/tariffa/);
    expect(roundUp(61, 30)).toBe(90);
    expect(roundUp(60, 30)).toBe(60);
    expect(roundUp(7, 1)).toBe(7);
  });
});
