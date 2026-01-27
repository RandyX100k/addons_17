# -*- coding: utf-8 -*-
# from odoo import http


# class BarcodeOrder(http.Controller):
#     @http.route('/barcode_order/barcode_order', auth='public')
#     def index(self, **kw):
#         return "Hello, world"

#     @http.route('/barcode_order/barcode_order/objects', auth='public')
#     def list(self, **kw):
#         return http.request.render('barcode_order.listing', {
#             'root': '/barcode_order/barcode_order',
#             'objects': http.request.env['barcode_order.barcode_order'].search([]),
#         })

#     @http.route('/barcode_order/barcode_order/objects/<model("barcode_order.barcode_order"):obj>', auth='public')
#     def object(self, obj, **kw):
#         return http.request.render('barcode_order.object', {
#             'object': obj
#         })

