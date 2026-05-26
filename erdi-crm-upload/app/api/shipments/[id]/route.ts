import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { status, trackingNumber, freightCost, shippedAt, estimatedArrival } = await req.json();

    const data: any = {};
    if (status) data.status = status;
    if (trackingNumber !== undefined) data.trackingNumber = trackingNumber;
    if (freightCost !== undefined) data.freightCost = parseFloat(freightCost);
    if (shippedAt !== undefined) data.shippedAt = shippedAt ? new Date(shippedAt) : null;
    if (estimatedArrival !== undefined) data.estimatedArrival = estimatedArrival ? new Date(estimatedArrival) : null;

    const shipment = await db.shipment.update({
      where: { id: params.id },
      data
    });

    return NextResponse.json(shipment);
  } catch (error) {
    console.error("Error updating shipment:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
