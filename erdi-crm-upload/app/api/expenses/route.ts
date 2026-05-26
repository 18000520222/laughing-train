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

    // Admins and Finance see all, others see only their own
    const whereClause = ["SUPER_ADMIN", "ADMIN", "FINANCE"].includes(user.role)
      ? {}
      : { submittedById: user.id };

    const expenses = await db.expenseClaim.findMany({
      where: whereClause,
      include: {
        submittedBy: { select: { name: true, email: true } },
        approvedBy: { select: { name: true, email: true } },
        opportunity: { select: { title: true, opportunityCode: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json(expenses);
  } catch (error) {
    console.error("Error fetching expenses:", error);
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
    const { title, amount, currency, category, description, opportunityId } = body;

    if (!title || !amount || !category) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const expense = await db.expenseClaim.create({
      data: {
        title,
        amount: parseFloat(amount),
        currency: currency || "CNY",
        category,
        description,
        opportunityId: opportunityId || null,
        submittedById: user.id
      }
    });

    return NextResponse.json(expense);
  } catch (error) {
    console.error("Error creating expense:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
