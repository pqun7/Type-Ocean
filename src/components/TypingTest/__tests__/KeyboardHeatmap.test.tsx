import { render, screen } from "@testing-library/react";

import KeyboardHeatmap from "@/components/TypingTest/KeyboardHeatmap";

describe("KeyboardHeatmap", () => {
  it("renders localized key labels for Arabic and English layouts", () => {
    const { rerender } = render(<KeyboardHeatmap language="ar" />);

    expect(screen.getByText("ض")).toBeInTheDocument();
    expect(screen.queryByText("Q")).not.toBeInTheDocument();
    expect(screen.getByText("مسافة")).toBeInTheDocument();

    rerender(<KeyboardHeatmap language="en" />);

    expect(screen.getByText("Q")).toBeInTheDocument();
    expect(screen.queryByText("ض")).not.toBeInTheDocument();
    expect(screen.getByText("space")).toBeInTheDocument();
  });
});