import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Landing } from "./landing";

describe("Landing", () => {
  it("creates a room with a valid nickname", () => {
    const onCreate = vi.fn();
    render(
      <Landing
        initialRoomCode=""
        connected
        error={null}
        onCreate={onCreate}
        onJoin={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Takma adın"), { target: { value: "Inan" } });
    fireEvent.click(screen.getByRole("button", { name: "Yeni oda oluştur" }));
    expect(onCreate).toHaveBeenCalledWith("Inan");
  });

  it("joins the room code supplied by the URL", () => {
    const onJoin = vi.fn();
    render(
      <Landing
        initialRoomCode="AB7K2M"
        connected
        error={null}
        onCreate={vi.fn()}
        onJoin={onJoin}
      />,
    );
    fireEvent.change(screen.getByLabelText("Takma adın"), { target: { value: "Guest" } });
    fireEvent.click(screen.getByRole("button", { name: "Odaya katıl" }));
    expect(onJoin).toHaveBeenCalledWith("AB7K2M", "Guest");
  });
});
