import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Admins and HR (if any, using SUPER_ADMIN/ADMIN for now) see all, others see only their own
    const whereClause = ["SUPER_ADMIN", "ADMIN"].includes(user.role)
      ? {}
      : { submittedById: user.id };

    const attendances = await db.attendanceRequest.findMany({
      where: whereClause,
      include: {
        submittedBy: { select: { name: true, email: true } },
        approvedBy: { select: { name: true, email: true } },
        company: { select: { name: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json(attendances);
  } catch (error) {
    console.error("Error fetching attendances:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { email: session.user.email }
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const { type, subType, startDate, endDate, reason, companyId } = body;

    if (!type || !startDate || !endDate || !reason) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const attendance = await db.attendanceRequest.create({
      data: {
        type,
        subType,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
        companyId: companyId || null,
        submittedById: user.id
      }
    });

    return NextResponse.json(attendance);
  } catch (error) {
    console.error("Error creating attendance:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
