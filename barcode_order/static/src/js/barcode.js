/** @odoo-module **/

import { Component, onWillStart, useState } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

export class CheckingProduct extends Component {
    static template = "barcoder_order.template";

    setup() {
        this.state = useState({
            loading: true,
            pickings: [],
            query: "",
            get filteredPickings() {
                const q = (this.query || "").trim().toLowerCase();
                if (!q) return this.pickings;
                return this.pickings.filter((p) =>
                    (p.name || "").toLowerCase().includes(q)
                );
            },
        });

        this.orm = useService("orm");
        this.notification = useService("notification");
        this.actionService = useService("action");

        onWillStart(async () => {
            await this.loadPickings();
        });
    }

    async loadPickings() {
        this.state.loading = true;
        try {
            const pickings = await this.orm.searchRead(
                "stock.picking",
                [["state", "=", "assigned"]],
                ["id", "name"]
            );

            if (!pickings || !pickings.length) {
                this.state.pickings = [];
                this.notification.add("No hay órdenes de entrega asignadas.", { type: "warning" });
                return;
            }

            this.state.pickings = pickings;
        } catch (e) {
            console.error(e);
            this.state.pickings = [];
            this.notification.add("Error cargando pickings (mira consola).", { type: "danger" });
        } finally {
            this.state.loading = false;
        }
    }

    clearSearch() {
        this.state.query = "";
    }

    openPicking(pickingId) {
        return this.actionService.doAction("barcode_order.barcoder_order_scan_action", {
            additionalContext: { picking_id: pickingId },
        });
    }
    
}
export class PickingScanner extends Component {
    static template = "barcoder_order.scan_template";

    setup() {
        this.state = useState({
            loading: true,
            pickingId: null,
            scan: "",
            lastScannedLineId: null, 
            lines: [],
            barcodeToIndex: {},
        });

        this.orm = useService("orm");
        this.notification = useService("notification");
        this.actionService = useService("action");

        onWillStart(async () => {
            const ctx = this.props?.action?.context || {};
            this.state.pickingId = ctx.picking_id;

            if (!this.state.pickingId) {
                this.notification.add("Falta picking_id en el contexto.", { type: "danger" });
                this.state.loading = false;
                return;
            }

            await this.loadLines();
        });
    }

    async loadLines() {
        this.state.loading = true;

        try {
            const picking = await this.orm.read(
                "stock.picking",
                [this.state.pickingId],
                ["name", "move_line_ids"]
            );
            const lineIds = picking?.[0]?.move_line_ids || [];

            if (!lineIds.length) {
                this.state.lines = [];
                this.state.barcodeToIndex = {};
                this.notification.add("Este picking no tiene líneas para escanear.", { type: "warning" });
                return;
            }

            const mls = await this.orm.read("stock.move.line", lineIds, [
                "id",
                "product_id",
                "product_uom_id",
                "qty_done",
                "move_id",
            ]);

            const moveIds = [...new Set(mls.map(x => x.move_id?.[0]).filter(Boolean))];
            const moves = moveIds.length
                ? await this.orm.read("stock.move", moveIds, ["id", "product_uom_qty"])
                : [];
            const moveQtyMap = Object.fromEntries(moves.map(m => [m.id, m.product_uom_qty]));

            const productIds = [...new Set(mls.map(x => x.product_id?.[0]).filter(Boolean))];
            const products = productIds.length
                ? await this.orm.read("product.product", productIds, ["id", "name", "barcode"])
                : [];
            const prodMap = Object.fromEntries(products.map(p => [p.id, p]));

            const uomIds = [...new Set(mls.map(x => x.product_uom_id?.[0]).filter(Boolean))];
            const uoms = uomIds.length ? await this.orm.read("uom.uom", uomIds, ["id", "name"]) : [];
            const uomMap = Object.fromEntries(uoms.map(u => [u.id, u.name]));

            const lines = mls.map(l => {
                const pid = l.product_id?.[0];
                const mid = l.move_id?.[0];
                const prod = pid ? prodMap[pid] : null;

                const required = mid ? (moveQtyMap[mid] || 0) : 0;
                const scanned = l.qty_done || 0;

                return {
                    line_id: l.id,
                    product_id: pid,
                    product_name: prod?.name || (l.product_id?.[1] || "Producto"),
                    barcode: prod?.barcode || null,
                    required_qty: required,
                    scanned_qty: scanned,
                    done: required > 0 && scanned >= required,
                    uom_name: uomMap[l.product_uom_id?.[0]] || "",

                    editing: false,
                    manual_qty: scanned,
                };
            });

            const barcodeToIndex = {};
            lines.forEach((ln, idx) => {
                if (ln.barcode && barcodeToIndex[ln.barcode] === undefined) {
                    barcodeToIndex[ln.barcode] = idx;
                }
            });

            this.state.lines = lines;
            this.state.barcodeToIndex = barcodeToIndex;

        } catch (e) {
            console.error(e);
            this.state.lines = [];
            this.state.barcodeToIndex = {};
            this.notification.add("Error cargando líneas del picking.", { type: "danger" });
        } finally {
            this.state.loading = false;
        }
    }

    onKeyDown(ev) {
        if (ev.key === "Enter") {
            ev.preventDefault();
            this.processScan();
        }
    }

    async processScan() {
        const code = (this.state.scan || "").trim();
        if (!code) return;

        const idx = this.state.barcodeToIndex[code];

        if (idx === undefined) {
            this.notification.add(`Ese barcode no está en el picking: ${code}`, { type: "danger" });
            this.state.scan = "";
            return;
        }

        const line = this.state.lines[idx];

        this.state.lastScannedLineId = line.line_id;

        if (line.done) {
            this.notification.add(`Ya está completo: ${line.product_name}`, { type: "warning" });
            this.state.scan = "";
            return;
        }

        const newQty = (line.scanned_qty || 0) + 1;

        line.scanned_qty = newQty;
        line.manual_qty = newQty; 
        line.done = line.required_qty > 0 && newQty >= line.required_qty;

        try {
            await this.orm.write("stock.move.line", [line.line_id], { qty_done: newQty });
        } catch (e) {
            console.error(e);
            this.notification.add("No pude guardar qty_done.", { type: "danger" });
        }

        this.state.scan = "";
    }

    toggleEdit(lineId) {
        const line = this.state.lines.find(l => l.line_id === lineId);
        if (!line) return;

        this.state.lines.forEach(l => { if (l.line_id !== lineId) l.editing = false; });

        line.editing = !line.editing;

        if (line.editing) {
            line.manual_qty = line.scanned_qty || 0;
            this.state.lastScannedLineId = line.line_id;
        }
    }

    async saveManual(lineId) {
        const line = this.state.lines.find(l => l.line_id === lineId);
        if (!line) return;

        const qty = Number(line.manual_qty);

        if (Number.isNaN(qty) || qty < 0) {
            this.notification.add("Cantidad inválida.", { type: "danger" });
            return;
        }

        line.scanned_qty = qty;
        line.done = line.required_qty > 0 && qty >= line.required_qty;
        line.editing = false;

        this.state.lastScannedLineId = line.line_id;

        try {
            await this.orm.write("stock.move.line", [line.line_id], { qty_done: qty });
            this.notification.add("Cantidad actualizada.", { type: "success" });
        } catch (e) {
            console.error(e);
            this.notification.add("No pude guardar la cantidad.", { type: "danger" });
        }
    }

    backToList() {
        this.actionService.doAction("barcode_order.barcoder_order_tag_action");
    }
}



registry.category("actions").add("barcode_order.component", CheckingProduct);
registry.category("actions").add("barcode_order.scan", PickingScanner);

