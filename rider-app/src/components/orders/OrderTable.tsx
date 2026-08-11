// === src/components/orders/OrderTable.tsx ===
// Desktop/wide-viewport table view of available orders (mobile uses OrderCard list).
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import type { AvailableOrder } from "@/types";

export function OrderTable({ orders, onAccept }: { orders: AvailableOrder[]; onAccept: (order: AvailableOrder) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Outlet</TableHead>
          <TableHead>Destination</TableHead>
          <TableHead>Distance</TableHead>
          <TableHead>Earning</TableHead>
          <TableHead>Total</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((o) => (
          <TableRow key={o.id}>
            <TableCell className="font-bold">
              {o.outletIcon} {o.outletName}
            </TableCell>
            <TableCell className="max-w-[200px] truncate">{o.address}</TableCell>
            <TableCell>{o.distance !== undefined ? `${o.distance.toFixed(1)} km` : "\u2014"}</TableCell>
            <TableCell className="font-bold text-[#10B981]">{formatCurrency(o.deliveryFee)}</TableCell>
            <TableCell>{formatCurrency(o.total)}</TableCell>
            <TableCell>
              <Button size="sm" onClick={() => onAccept(o)}>
                Accept
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
