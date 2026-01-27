# -*- coding: utf-8 -*-

# from odoo import models, fields, api


# class barcode_order(models.Model):
#     _name = 'barcode_order.barcode_order'
#     _description = 'barcode_order.barcode_order'

#     name = fields.Char()
#     value = fields.Integer()
#     value2 = fields.Float(compute="_value_pc", store=True)
#     description = fields.Text()
#
#     @api.depends('value')
#     def _value_pc(self):
#         for record in self:
#             record.value2 = float(record.value) / 100

