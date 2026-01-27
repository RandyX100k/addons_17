# -*- coding: utf-8 -*-
{
    'name': "barcode_order",

    'summary': "Short (1 phrase/line) summary of the module's purpose",

    'description': """
Long description of module's purpose
    """,

    'author': "My Company",
    'website': "https://www.yourcompany.com",

   
    'category': 'Uncategorized',
    'version': '0.1',

    'depends': ['stock_barcode','sale_customs_extend'],

    'data': [
        # 'security/ir.model.access.csv',
        'views/views.xml',
    ],
   
    "assets":{
        "web.assets_backend":[
            "barcode_order/static/src/css/barcode.css",
            "barcode_order/static/src/xml/barcode.xml",
            "barcode_order/static/src/js/barcode.js",
        ]
    }
}

