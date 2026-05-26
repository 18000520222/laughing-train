"use client";

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { Truck, Loader2, Plus, Edit2 } from "lucide-react";

export function ShipmentList({ opportunities }: { opportunities: any[] }) {
  const [shipments, setShipments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  const [opportunityId, setOpportunityId] = useState("");
  const [carrier, setCarrier] = useState("DHL");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [freightCost, setFreightCost] = useState("");
  const [shippedAt, setShippedAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchShipments();
  }, []);

  const fetchShipments = async () => {
    try {
      const res = await fetch("/api/shipments");
      const data = await res.json();
      setShipments(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!opportunityId) {
      toast({ title: "Error", description: "Select an opportunity", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId,
          carrier,
          trackingNumber,
          freightCost,
          shippedAt: shippedAt || undefined
        })
      });

      if (!res.ok) throw new Error("Failed to create shipment");
      toast({ title: "Success", description: "Shipment record created." });
      setIsDialogOpen(false);
      fetchShipments();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/shipments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error("Failed to update status");
      toast({ title: "Status Updated" });
      fetchShipments();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const statusColors: any = {
    PENDING: "bg-yellow-100 text-yellow-800",
    SHIPPED: "bg-blue-100 text-blue-800",
    DELIVERED: "bg-green-100 text-green-800"
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> New Shipment</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Shipment Record (新建发货)</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Opportunity (关联商机)</Label>
                <Select value={opportunityId} onValueChange={setOpportunityId}>
                  <SelectTrigger><SelectValue placeholder="Select Opportunity" /></SelectTrigger>
                  <SelectContent>
                    {opportunities.map(opp => (
                      <SelectItem key={opp.id} value={opp.id}>
                        {opp.opportunityCode || opp.title} ({opp.company.name})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Carrier (承运商)</Label>
                  <Input required value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="e.g. DHL, UPS, FedEx" />
                </div>
                <div className="space-y-2">
                  <Label>Tracking Number (运单号)</Label>
                  <Input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Freight Cost (运费 CNY - Optional)</Label>
                  <Input type="number" step="0.01" value={freightCost} onChange={e => setFreightCost(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Shipped Date (发货日期)</Label>
                  <Input type="date" value={shippedAt} onChange={e => setShippedAt(e.target.value)} />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Save Shipment"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Opportunity / Customer</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead>Tracking No.</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">Loading...</TableCell></TableRow>
              ) : shipments.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8">No shipments found.</TableCell></TableRow>
              ) : (
                shipments.map(s => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.opportunity.title}</div>
                      <div className="text-xs text-muted-foreground">{s.opportunity.company.name}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Truck className="w-4 h-4 text-muted-foreground" />
                        {s.carrier}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{s.trackingNumber || '-'}</TableCell>
                    <TableCell>{s.shippedAt ? format(new Date(s.shippedAt), "yyyy-MM-dd") : '-'}</TableCell>
                    <TableCell>{s.freightCost ? `¥${s.freightCost}` : '-'}</TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColors[s.status]}`}>
                        {s.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      {s.status === 'PENDING' && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus(s.id, 'SHIPPED')}>Mark Shipped</Button>
                      )}
                      {s.status === 'SHIPPED' && (
                        <Button size="sm" variant="outline" className="text-green-600 border-green-200" onClick={() => updateStatus(s.id, 'DELIVERED')}>Mark Delivered</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
