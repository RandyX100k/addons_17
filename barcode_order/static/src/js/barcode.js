/** @odoo-module **/

import { Component, onWillStart, useRef, useState  } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import * as BarcodeScanner from '@web/webclient/barcode/barcode_scanner';

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
                ["id", "name", "assigned_id_packing"]
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
            clientInfo: {},
            addOpen: false,
            addQuery: "",
            addResults: [],
            addSelected: null,
            addQty: 1,
            addSaving: false,
            products: [],
            addProductId: "",
            productFilter: "",
            note: false,
            noteText: "",
            noteSaving: false,




        });

        this.orm = useService("orm");
        this.notification = useService("notification");
        this.actionService = useService("action");
        this.mobileScanner = BarcodeScanner.isBarcodeScannerSupported();

        this._scanQueue = [];
        this._draining = false;
        this.inputScan = useRef("inputScan");


        this._writeByLine = new Map();

        onWillStart(async () => {
            const ctx = this.props?.action?.context || {};
            this.state.pickingId = ctx.picking_id;

            if (!this.state.pickingId) {
                this.notification.add("Falta picking_id en el contexto.", { type: "danger" });
                this.state.loading = false;
                return;
            }

            await this.loadLines();

            const products = await this.orm.searchRead("product.template", [], ["id", "name","barcode"]);
            this.state.products = products;
        });
    }

    async loadLines() {
        this.state.loading = true;

        try {
            const picking = await this.orm.read(
                "stock.picking",
                [this.state.pickingId],
                ["name", "move_line_ids", "partner_id", "assigned_id_packing"]
            );

            const lineIds = picking?.[0]?.move_line_ids || [];

            this.state.clientInfo = {
                client: picking[0].partner_id[1],
                assigned_id_packing: picking[0].assigned_id_packing[1] ? picking[0].assigned_id_packing[1] : 'no tiene'

            }

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
                    move_id: mid,
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

            const code = (this.state.scan || "").trim();
            this.state.scan = "";
            if (!code) return;

            this.enqueueScan(code);
        }
    }

    enqueueScan(code) {
        this._scanQueue.push(code);
        this.drainQueue();
    }

    async drainQueue() {
        if (this._draining) return;
        this._draining = true;

        try {
            while (this._scanQueue.length) {
                const code = this._scanQueue.shift();
                await this.handleOneScan(code);
            }
        } finally {
            this._draining = false;
        }
    }

    async handleOneScan(code) {
        const idx = this.state.barcodeToIndex[code];

        if (idx === undefined) {
            this.notification.add(`Ese barcode no está en el picking: ${code}`, { type: "danger" });
            return;
        }

        const line = this.state.lines[idx];
        this.state.lastScannedLineId = line.line_id;

        if (line.done) {
            this.notification.add(`Ya está completo: ${line.product_name}`, { type: "warning" });
            return;
        }

        const newQty = (line.scanned_qty || 0) + 1;

        line.scanned_qty = newQty;
        line.manual_qty = newQty;
        line.done = line.required_qty > 0 && newQty >= line.required_qty;

        this.queueWriteQtyDone(line.line_id, newQty).catch((e) => {
            console.error(e);
            this.notification.add("No pude guardar qty_done.", { type: "danger" });
        });
    }

    queueWriteQtyDone(lineId, qty) {
        const prev = this._writeByLine.get(lineId) || Promise.resolve();

        const next = prev.then(() => {
            return this.orm.write("stock.move.line", [lineId], { qty_done: qty });
        });

        this._writeByLine.set(lineId, next.catch(() => { }));
        return next;
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
            await this.queueWriteQtyDone(line.line_id, qty);
            this.notification.add("Cantidad actualizada.", { type: "success" });
        } catch (e) {
            console.error(e);
            this.notification.add("No pude guardar la cantidad.", { type: "danger" });
        } finally {
            this.inputScan.el?.focus();
        }
    }

    backToList() {
        this.actionService.doAction("barcode_order.barcoder_order_tag_action");
        this.inputScan.el?.focus();
    }

    async Delete(lineId) {
        const line = this.state.lines.find(l => l.line_id === lineId);
        if (!line) return;

        const ok = window.confirm(`¿Eliminar el producto del picking?\n${line.product_name}`);
        if (!ok) return;

        try {
            if (line.move_id) {
                const mlIds = await this.orm.search("stock.move.line", [["move_id", "=", line.move_id]]);
                if (mlIds.length) {
                    await this.orm.unlink("stock.move.line", mlIds);
                }

                await this.orm.unlink("stock.move", [line.move_id]);
            } else {
                await this.orm.unlink("stock.move.line", [line.line_id]);
            }

            this.notification.add("Producto eliminado del picking.", { type: "success" });

            await this.loadLines();
        } catch (e) {
            console.error(e);
            this.notification.add("No pude eliminar el producto del picking.", { type: "danger" });
            await this.loadLines();
        }finally{
            this.inputScan.el?.focus();
        }
    }


    openAddProduct() {
        this.state.addOpen = true;
        this.state.addProductId = "";
        this.state.addQty = 1;
        this.state.addSaving = false;
        this.state.productFilter = "";
    }


    closeAddProduct() {
        this.state.addOpen = false;
    }

    async onAddKeydown(ev) {
        if (ev.key === "Enter") {
            ev.preventDefault();
            await this.searchProducts();
        }
    }

    async searchProducts() {
        const q = (this.state.addQuery || "").trim();
        if (!q) return;

        try {
     
            const domain = ["|", ["barcode", "=", q], ["name", "ilike", q]];
            const ids = await this.orm.search("product.product", domain, { limit: 20 });
            if (!ids.length) {
                this.state.addResults = [];
                this.notification.add("No encontré productos con ese criterio.", { type: "warning" });
                return;
            }

            const prods = await this.orm.read("product.product", ids, ["id", "name", "barcode", "uom_id"]);
            this.state.addResults = prods;
        } catch (e) {
            console.error(e);
            this.notification.add("Error buscando productos.", { type: "danger" });
        }
    }

    selectAddProduct(p) {
        this.state.addSelected = p;
        if (!this.state.addQty || this.state.addQty < 1) this.state.addQty = 1;
    }


    async confirmAddProduct() {
        const templateId = Number(this.state.addProductId);
        const qty = Number(this.state.addQty);

        if (!templateId) return;

        if (!Number.isFinite(qty) || qty <= 0) {
            this.notification.add("Cantidad inválida.", { type: "danger" });
            return;
        }

        this.state.addSaving = true;

        try {
            const [pk] = await this.orm.read(
                "stock.picking",
                [this.state.pickingId],
                ["location_id", "location_dest_id", "company_id"]
            );
            if (!pk) throw new Error("No pude leer el picking.");

            const productVariantIds = await this.orm.search(
                "product.product",
                [["product_tmpl_id", "=", templateId]],
                { limit: 1 }
            );
            if (!productVariantIds.length) {
                this.notification.add("Ese producto no tiene variante (product.product).", { type: "danger" });
                return;
            }

            const [prod] = await this.orm.read(
                "product.product",
                productVariantIds,
                ["id", "display_name", "uom_id"]
            );

            const uomId = prod?.uom_id?.[0];
            if (!uomId) throw new Error("El producto no tiene UoM.");

            const createdMove = await this.orm.create("stock.move", [{
                name: prod.display_name,
                picking_id: this.state.pickingId,
                product_id: prod.id,
                product_uom_qty: qty,
                product_uom: uomId,
                location_id: pk.location_id?.[0],
                location_dest_id: pk.location_dest_id?.[0],
                company_id: pk.company_id?.[0],
            }]);

            const moveId = Array.isArray(createdMove) ? createdMove[0] : createdMove;

            if (!moveId) {
                throw new Error("No pude obtener el ID del movimiento creado.");
            }

            await this.orm.create("stock.move.line", [{
                picking_id: this.state.pickingId,
                move_id: moveId,
                product_id: prod.id,
                product_uom_id: uomId,
                location_id: pk.location_id?.[0],
                location_dest_id: pk.location_dest_id?.[0],
                qty_done: 0,
            }]);

            this.notification.add("Producto agregado al picking.", { type: "success" });
            this.closeAddProduct();
            await this.orm.call("stock.picking", "action_confirm", [[this.state.pickingId]]);
            await this.orm.call("stock.picking", "action_assign", [[this.state.pickingId]]);
            await this.loadLines();
        } catch (e) {
            console.error(e);
            this.notification.add("No pude agregar el producto al picking.", { type: "danger" });
        } finally {
            this.state.addSaving = false;
        }
    }


    get filteredProducts() {
        const q = (this.state.productFilter || "").trim().toLowerCase();
        if (!q) return this.state.products;
      
        return this.state.products.filter(p => {
          const name = (p.name || "").toLowerCase();
          const barcode = String(p.barcode || "").toLowerCase();
          return name.includes(q) || barcode.includes(q);
        });
      }
      

      _delay(ms) {
        return new Promise((r) => setTimeout(r, ms));
      }
      
      async openMobileScanner() {
        const minMs = 3000;  
        const maxTries = 5;
      
        for (let i = 0; i < maxTries; i++) {
          const start = Date.now();
          const barcode = await BarcodeScanner.scanBarcode(this.env);
      
          if (!barcode) {
            this.notification.add("Please, Scan again!"), { type: "warning" };
            return;
          }
      
          const elapsed = Date.now() - start;
      
          if (elapsed < minMs) {
            await this._delay(minMs - elapsed);
            this.notification.add("Espera un momento y vuelve a apuntar…"), { type: "info" };
            continue;
          }
      
          const code = String(barcode).trim();
          if (!code) continue;
      
          this.enqueueScan(code);
          if ("vibrate" in window.navigator) window.navigator.vibrate(100);
          return;
        }
      
        this.notification.add("No pude leer un código válido."), { type: "danger" };
      }
      


    AddNote() {
        this.state.note = true;
    }

    closeAddNote() {
        this.state.note = false;
        this.state.noteText = "";
    }

    async ConfirmNote() {
        const pickingId = this.state.pickingId;
        const text = (this.state.noteText || "").trim();

        if (!text) return;

        try {
            this.state.noteSaving = true;

            const escapeHtml = (s) =>
                s.replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");

            const html = `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`;

            const [pick] = await this.orm.read("stock.picking", [pickingId], ["note"]);
            const current = (pick?.note || "").trim();

            const newNote = current ? `${current}<br/>${html}` : html;

            await this.orm.write("stock.picking", [pickingId], { note: newNote });

            await this.orm.call("stock.picking", "message_post", [[pickingId]], {
                body: html,
                message_type: "comment",
                subtype_xmlid: "mail.mt_comment",
            });

            this.notificationService?.add(_t("Nota guardada y enviada al chatter."), { type: "success" });
            this.closeAddNote();
        } catch (e) {
            console.error(e);
            this.notificationService?.add(_t("No se pudo guardar la nota."), { type: "danger" });
        } finally {
            this.state.noteSaving = false;
        }
    }





}


registry.category("actions").add("barcode_order.component", CheckingProduct);
registry.category("actions").add("barcode_order.scan", PickingScanner);

