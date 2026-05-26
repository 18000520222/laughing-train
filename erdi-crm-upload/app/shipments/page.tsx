import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { ShipmentList } from "./ShipmentList";
import { db } from "@/lib/db";

export default async function ShipmentsPage() {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  // Fetch opportunities (CLOSED_WON or any that make sense) to attach shipments
  const opportunities = await db.opportunity.findMany({
    where: { stage: { in: ["CLOSED_WON", "NEGOTIATING", "SPEC_CONFIRMING"] } },
    select: { id: true, title: true, opportunityCode: true, company: { select: { name: true } } }
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Logistics & Shipments (发货管理)</h1>
      </div>
      <ShipmentList opportunities={opportunities} />
    </div>
  );
}
