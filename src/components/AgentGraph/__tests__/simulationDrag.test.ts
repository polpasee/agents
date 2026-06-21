import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above all declarations.
// Use only inline vi.fn() inside the factory — no outer-scope variables.
vi.mock("d3-drag", () => ({
  drag: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
  })),
}));

import { simulationDrag } from "../simulationDrag";
import { drag } from "d3-drag";

interface MockDragEvent {
  active: boolean;
  x: number;
  y: number;
  subject: {
    x: number;
    y: number;
    fx: number | null;
    fy: number | null;
  };
}

type Simulation = import("d3-force").Simulation<
  import("@/lib/d3").SimNode,
  import("@/lib/d3").SimLink
>;

function makeSimulation() {
  return {
    alphaTarget: vi.fn().mockReturnThis(),
    restart: vi.fn().mockReturnThis(),
  };
}

function makeEvent(overrides: Partial<MockDragEvent> = {}): MockDragEvent {
  return {
    active: false,
    x: 10,
    y: 20,
    subject: { x: 5, y: 15, fx: null, fy: null },
    ...overrides,
  };
}

/** Return the handler registered for a given event name by inspecting .on() calls */
function getHandler(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  behavior: import("d3-drag").DragBehavior<any, any, any>,
  name: string,
): (e: MockDragEvent) => void {
  const onMock = vi.mocked(behavior.on);
  const call = onMock.mock.calls.find(([n]) => n === name);
  if (!call) throw new Error(`No handler registered for "${name}"`);
  return call[1] as unknown as (e: MockDragEvent) => void;
}

describe("simulationDrag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the .on() chain after clearAllMocks
    const behavior = { on: vi.fn().mockReturnThis() };
    vi.mocked(drag).mockReturnValue(
      behavior as unknown as ReturnType<typeof drag>,
    );
  });

  it("calls d3-drag's drag() factory and returns its result", () => {
    const sim = makeSimulation();
    const result = simulationDrag(sim as unknown as Simulation);
    expect(drag).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("registers 'start', 'drag', and 'end' event handlers via .on()", () => {
    const sim = makeSimulation();
    const behavior = simulationDrag(sim as unknown as Simulation);
    const names = vi.mocked(behavior.on).mock.calls.map(([n]) => n);
    expect(names).toContain("start");
    expect(names).toContain("drag");
    expect(names).toContain("end");
  });

  describe("dragstart handler", () => {
    it("heats simulation when !event.active: alphaTarget(0.3) then restart()", () => {
      const sim = makeSimulation();
      const behavior = simulationDrag(sim as unknown as Simulation);
      const handler = getHandler(behavior, "start");

      handler(makeEvent({ active: false }));

      expect(sim.alphaTarget).toHaveBeenCalledWith(0.3);
      expect(sim.restart).toHaveBeenCalled();
    });

    it("skips alphaTarget/restart when event.active is true", () => {
      const sim = makeSimulation();
      const behavior = simulationDrag(sim as unknown as Simulation);
      const handler = getHandler(behavior, "start");

      handler(makeEvent({ active: true }));

      expect(sim.alphaTarget).not.toHaveBeenCalled();
      expect(sim.restart).not.toHaveBeenCalled();
    });

    it("pins subject.fx/fy to subject.x/y at drag start", () => {
      const sim = makeSimulation();
      const behavior = simulationDrag(sim as unknown as Simulation);
      const handler = getHandler(behavior, "start");

      const event = makeEvent({
        subject: { x: 42, y: 99, fx: null, fy: null },
      });
      handler(event);

      expect(event.subject.fx).toBe(42);
      expect(event.subject.fy).toBe(99);
    });
  });

  describe("drag handler", () => {
    it("updates subject.fx/fy to event.x/y during drag", () => {
      const sim = makeSimulation();
      const behavior = simulationDrag(sim as unknown as Simulation);
      const handler = getHandler(behavior, "drag");

      const event = makeEvent({
        x: 300,
        y: 400,
        subject: { x: 0, y: 0, fx: null, fy: null },
      });
      handler(event);

      expect(event.subject.fx).toBe(300);
      expect(event.subject.fy).toBe(400);
    });

    it("does not touch the simulation during drag", () => {
      const sim = makeSimulation();
      const behavior = simulationDrag(sim as unknown as Simulation);
      const handler = getHandler(behavior, "drag");

      handler(makeEvent());

      expect(sim.alphaTarget).not.toHaveBeenCalled();
      expect(sim.restart).not.toHaveBeenCalled();
    });
  });

  describe("dragend handler", () => {
    it("cools simulation to alphaTarget(0) when !event.active", () => {
      const sim = makeSimulation();
      const behavior = simulationDrag(sim as unknown as Simulation);
      const handler = getHandler(behavior, "end");

      handler(
        makeEvent({ active: false, subject: { x: 0, y: 0, fx: 5, fy: 10 } }),
      );

      expect(sim.alphaTarget).toHaveBeenCalledWith(0);
    });

    it("skips alphaTarget when event.active is true", () => {
      const sim = makeSimulation();
      const behavior = simulationDrag(sim as unknown as Simulation);
      const handler = getHandler(behavior, "end");

      handler(
        makeEvent({ active: true, subject: { x: 0, y: 0, fx: 5, fy: 10 } }),
      );

      expect(sim.alphaTarget).not.toHaveBeenCalled();
    });

    it("releases fx/fy (sets both to null) at drag end", () => {
      const sim = makeSimulation();
      const behavior = simulationDrag(sim as unknown as Simulation);
      const handler = getHandler(behavior, "end");

      const event = makeEvent({ subject: { x: 0, y: 0, fx: 100, fy: 200 } });
      handler(event);

      expect(event.subject.fx).toBeNull();
      expect(event.subject.fy).toBeNull();
    });
  });
});
