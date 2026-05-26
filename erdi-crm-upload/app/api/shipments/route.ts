import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const shipments = await db.shipment.findMany({
      include: {
        opportunity: { select: { title: true, opportunityCode: true, company: { select: { name: true } } } }
      },
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json(shipments);
  } catch (error) {
    console.error("Error fetching shipments:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { opportunityId, carrier, trackingNumber, freightCost, shippedAt, estimatedArrival } = body;

    if (!opportunityId || !carrier) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const shipment = await db.shipment.create({
      data: {
        opportunityId,
        carrier,
        trackingNumber,
        freightCost: freightCost ? parseFloat(freightCost) : null,
        shippedAt: shippedAt ? new Date(shippedAt) : null,
        estimatedArrival: estimatedArrival ? new Date(estimatedArrival) : null,
        status: shippedAt ? "SHIPPED" : "PENDING"
      }
    });

    return NextResponse.json(shipment);
  } catch (error) {
    console.error("Error creating shipment:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
