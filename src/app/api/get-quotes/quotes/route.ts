// src/app/api/scheduler/route.ts
import { NextResponse } from "next/server";
import { saveQuoteToFile } from "../route"; // تأكد من المسار الصحيح

let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;

export async function GET() {
  if (!isRunning) {
    isRunning = true;
    intervalId = setInterval(async () => {
      try {
        await saveQuoteToFile();
      } catch (error) {
        console.error('Error in scheduled task:', error);
      }
    }, 2000);

    return NextResponse.json(
      { message: "Scheduler started successfully" },
      { status: 200 }
    );
  }
  
  return NextResponse.json(
    { message: "Scheduler is already running" },
    { status: 409 } 
  );
}

export async function DELETE() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    isRunning = false;
    return NextResponse.json(
      { message: "Scheduler stopped successfully" },
      { status: 200 }
    );
  }
  
  return NextResponse.json(
    { message: "No active scheduler to stop" },
    { status: 404 }
  );
}