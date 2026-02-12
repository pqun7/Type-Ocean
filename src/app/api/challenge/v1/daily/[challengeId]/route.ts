import type { NextRequest } from "next/server";
import { handleChallengeUpdate } from "../route";

export const PUT = (req: NextRequest) => handleChallengeUpdate(req, "PUT");
