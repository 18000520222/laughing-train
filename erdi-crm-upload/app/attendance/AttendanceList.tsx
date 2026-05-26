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
import { Check, X, Loader2, Plus, Calendar, Plane } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function AttendanceList({ isAdmin, companies }: { isAdmin: boolean, companies: any[] }) {
  const [attendances, setAttendances] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();

  // Form state
  const [type, setType] = useState("LEAVE");
  const [subType, setSubType] = useState("ANNUAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [companyId, setCompanyId] = useState("none");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchAttendances();
  }, []);

  const fetchAttendances = async () => {
    try {
      const res = await fetch("/api/attendance");
      const data = await res.json();
      setAttendances(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          subType,
          startDate,
          endDate,
          reason,
          companyId: type === "BUSINESS_TRIP" && companyId !== "none" ? companyId : undefined
        })
      });

      if (!res.ok) throw new Error("Failed to submit request");
      
      toast({ title: "Success", description: "Request submitted." });
      setIsDialogOpen(false);
      fetchAttendances();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/attendance/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error("Update failed");
      toast({ title: "Status Updated" });
      fetchAttendances();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const statusColors: any = {
    PENDING: "bg-yellow-100 text-yellow-800",
    APPROVED: "bg-green-100 text-green-800",
    REJECTED: "bg-red-100 text-red-800"
  };

  const leaves = attendances.filter(a => a.type === "LEAVE");
  const trips = attendances.filter(a => a.type === "BUSINESS_TRIP");

  const TableLayout = ({ data }: { data: any[] }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Requested By</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Date Range</TableHead>
          <TableHead>Reason</TableHead>
          <TableHead>Status</TableHead>
          {isAdmin && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
        ) : data.length === 0 ? (
          <TableRow><TableCell colSpan={6} className="text-center py-8">No records found.</TableCell></TableRow>
        ) : (
          data.map(req => (
            <TableRow key={req.id}>
              <TableCell className="font-medium">{req.submittedBy.name}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  {req.type === 'LEAVE' ? <Calendar className="w-4 h-4 text-orange-500" /> : <Plane className="w-4 h-4 text-blue-500" />}
                  <span>{req.subType}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="text-sm">
                  {format(new Date(req.startDate), "yyyy-MM-dd")} to {format(new Date(req.endDate), "yyyy-MM-dd")}
                </div>
              </TableCell>
              <TableCell>
                <div className="max-w-[200px] truncate" title={req.reason}>{req.reason}</div>
                {req.company && <div className="text-xs text-muted-foreground mt-1">Visiting: {req.company.name}</div>}
              </TableCell>
              <TableCell>
                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColors[req.status]}`}>
                  {req.status}
                </span>
              </TableCell>
              {isAdmin && (
                <TableCell className="text-right space-x-2">
                  {req.status === 'PENDING' && (
                    <>
                      <Button size="sm" variant="outline" className="text-green-600 border-green-200" onClick={() => handleStatusUpdate(req.id, 'APPROVED')}>
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-600 border-red-200" onClick={() => handleStatusUpdate(req.id, 'REJECTED')}>
                        <X className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> New Request</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Submit Attendance Request (新建申请)</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type (类型)</Label>
                  <Select value={type} onValueChange={(val) => { setType(val); setSubType(val === 'LEAVE' ? 'ANNUAL' : 'CLIENT_VISIT'); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LEAVE">Leave (请假)</SelectItem>
                      <SelectItem value="BUSINESS_TRIP">Business Trip (出差)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Sub Type (详细)</Label>
                  <Select value={subType} onValueChange={setSubType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {type === 'LEAVE' ? (
                        <>
                          <SelectItem value="ANNUAL">Annual Leave (年假)</SelectItem>
                          <SelectItem value="SICK">Sick Leave (病假)</SelectItem>
                          <SelectItem value="PERSONAL">Personal Leave (事假)</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="CLIENT_VISIT">Client Visit (拜访客户)</SelectItem>
                          <SelectItem value="EXHIBITION">Exhibition (展会)</SelectItem>
                          <SelectItem value="OTHER">Other (其他)</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
              </div>

              {type === 'BUSINESS_TRIP' && (
                <div className="space-y-2">
                  <Label>Related Customer (关联客户 - Optional)</Label>
                  <Select value={companyId} onValueChange={setCompanyId}>
                    <SelectTrigger><SelectValue placeholder="Select Customer" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- None --</SelectItem>
                      {companies.map(comp => (
                        <SelectItem key={comp.id} value={comp.id}>{comp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Reason (事由)</Label>
                <Input required value={reason} onChange={e => setReason(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : "Submit Request"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="leave" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="leave">Leave Requests (请假)</TabsTrigger>
          <TabsTrigger value="trip">Business Trips (出差)</TabsTrigger>
        </TabsList>
        <TabsContent value="leave">
          <Card>
            <CardContent className="p-0">
              <TableLayout data={leaves} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="trip">
          <Card>
            <CardContent className="p-0">
              <TableLayout data={trips} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
