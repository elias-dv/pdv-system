#!/usr/bin/env python3
"""Builds polished PDV Excel reports with native charts.

Input is JSON on stdin. Output path is passed as argv[2].
"""

from __future__ import annotations

import json
import sys
from datetime import datetime

try:
    import xlsxwriter
except ModuleNotFoundError:
    sys.stderr.write("XlsxWriter is not installed. Run: python3 -m pip install -r requirements.txt\n")
    sys.exit(3)


COLORS = {
    "ink": "#1D1D1F",
    "muted": "#6E6E73",
    "faint": "#F5F5F7",
    "alt": "#FBFBFD",
    "line": "#D2D2D7",
    "white": "#FFFFFF",
    "blue": "#007AFF",
    "blue_dark": "#0B3A66",
    "blue_soft": "#E8F2FF",
    "green": "#34C759",
    "green_soft": "#E8F8EE",
    "red": "#FF3B30",
    "red_soft": "#FFE9E8",
    "orange": "#FF9F0A",
    "orange_soft": "#FFF5E6",
}

MONEY_FMT = '"R$" #,##0.00;[Red]-"R$" #,##0.00'
DATE_FMT = "dd/mm/yyyy"


def main() -> int:
    if len(sys.argv) != 3:
        sys.stderr.write("Usage: reportWorkbookBuilder.py <daily|sales_history> <output.xlsx>\n")
        return 2

    kind = sys.argv[1]
    output_path = sys.argv[2]
    payload = json.load(sys.stdin)

    workbook = xlsxwriter.Workbook(
        output_path,
        {
            "strings_to_formulas": False,
            "strings_to_urls": False,
            "constant_memory": False,
        },
    )
    workbook.set_properties(
        {
            "title": "PDV Sistema",
            "subject": "Relatorio operacional",
            "author": "PDV Sistema",
            "company": payload.get("storeName") or "PDV Sistema",
            "created": datetime.now(),
        }
    )

    formats = make_formats(workbook)

    if kind == "daily":
        build_daily_workbook(workbook, formats, payload)
    elif kind == "sales_history":
        build_sales_history_workbook(workbook, formats, payload)
    else:
        workbook.close()
        sys.stderr.write(f"Unknown workbook kind: {kind}\n")
        return 2

    workbook.close()
    return 0


def make_formats(workbook):
    base = {"font_name": "Aptos", "font_size": 10, "font_color": COLORS["ink"]}
    return {
        "title": workbook.add_format(
            {
                **base,
                "bold": True,
                "font_size": 18,
                "font_color": COLORS["white"],
                "bg_color": COLORS["blue_dark"],
                "align": "left",
                "valign": "vcenter",
            }
        ),
        "subtitle": workbook.add_format(
            {
                **base,
                "font_size": 10,
                "font_color": COLORS["white"],
                "bg_color": COLORS["blue_dark"],
                "align": "left",
                "valign": "vcenter",
            }
        ),
        "section": workbook.add_format(
            {
                **base,
                "bold": True,
                "font_color": COLORS["blue_dark"],
                "bg_color": COLORS["blue_soft"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "valign": "vcenter",
            }
        ),
        "table_header": workbook.add_format(
            {
                **base,
                "bold": True,
                "font_color": COLORS["white"],
                "bg_color": COLORS["blue_dark"],
                "border": 1,
                "border_color": COLORS["blue_dark"],
                "align": "center",
                "valign": "vcenter",
            }
        ),
        "body": workbook.add_format(
            {
                **base,
                "bg_color": COLORS["white"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "valign": "vcenter",
            }
        ),
        "body_alt": workbook.add_format(
            {
                **base,
                "bg_color": COLORS["alt"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "valign": "vcenter",
            }
        ),
        "body_center": workbook.add_format(
            {
                **base,
                "bg_color": COLORS["white"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "align": "center",
                "valign": "vcenter",
            }
        ),
        "body_center_alt": workbook.add_format(
            {
                **base,
                "bg_color": COLORS["alt"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "align": "center",
                "valign": "vcenter",
            }
        ),
        "money": workbook.add_format(
            {
                **base,
                "num_format": MONEY_FMT,
                "bg_color": COLORS["white"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "money_alt": workbook.add_format(
            {
                **base,
                "num_format": MONEY_FMT,
                "bg_color": COLORS["alt"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "money_blue": workbook.add_format(
            {
                **base,
                "bold": True,
                "font_color": COLORS["blue"],
                "num_format": MONEY_FMT,
                "bg_color": COLORS["white"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "money_green": workbook.add_format(
            {
                **base,
                "bold": True,
                "font_color": COLORS["green"],
                "num_format": MONEY_FMT,
                "bg_color": COLORS["white"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "money_red": workbook.add_format(
            {
                **base,
                "bold": True,
                "font_color": COLORS["red"],
                "num_format": MONEY_FMT,
                "bg_color": COLORS["white"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "number": workbook.add_format(
            {
                **base,
                "num_format": "#,##0",
                "bg_color": COLORS["white"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "number_alt": workbook.add_format(
            {
                **base,
                "num_format": "#,##0",
                "bg_color": COLORS["alt"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "quantity": workbook.add_format(
            {
                **base,
                "num_format": "#,##0.###",
                "bg_color": COLORS["white"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "percent": workbook.add_format(
            {
                **base,
                "num_format": "0.0%",
                "bg_color": COLORS["white"],
                "bottom": 1,
                "bottom_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "kpi_label": workbook.add_format(
            {
                **base,
                "font_size": 9,
                "font_color": COLORS["muted"],
                "bg_color": COLORS["faint"],
                "top": 1,
                "left": 1,
                "right": 1,
                "top_color": COLORS["line"],
                "left_color": COLORS["line"],
                "right_color": COLORS["line"],
                "valign": "vcenter",
            }
        ),
        "kpi_value": workbook.add_format(
            {
                **base,
                "bold": True,
                "font_size": 14,
                "bg_color": COLORS["faint"],
                "bottom": 1,
                "left": 1,
                "right": 1,
                "bottom_color": COLORS["line"],
                "left_color": COLORS["line"],
                "right_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "kpi_money": workbook.add_format(
            {
                **base,
                "bold": True,
                "font_size": 14,
                "num_format": MONEY_FMT,
                "bg_color": COLORS["faint"],
                "bottom": 1,
                "left": 1,
                "right": 1,
                "bottom_color": COLORS["line"],
                "left_color": COLORS["line"],
                "right_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "kpi_money_blue": workbook.add_format(
            {
                **base,
                "bold": True,
                "font_size": 14,
                "font_color": COLORS["blue"],
                "num_format": MONEY_FMT,
                "bg_color": COLORS["faint"],
                "bottom": 1,
                "left": 1,
                "right": 1,
                "bottom_color": COLORS["line"],
                "left_color": COLORS["line"],
                "right_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "kpi_money_green": workbook.add_format(
            {
                **base,
                "bold": True,
                "font_size": 14,
                "font_color": COLORS["green"],
                "num_format": MONEY_FMT,
                "bg_color": COLORS["faint"],
                "bottom": 1,
                "left": 1,
                "right": 1,
                "bottom_color": COLORS["line"],
                "left_color": COLORS["line"],
                "right_color": COLORS["line"],
                "align": "right",
                "valign": "vcenter",
            }
        ),
        "empty": workbook.add_format(
            {
                **base,
                "font_color": COLORS["muted"],
                "italic": True,
                "bg_color": COLORS["faint"],
                "border": 1,
                "border_color": COLORS["line"],
                "align": "center",
                "valign": "vcenter",
            }
        ),
        "note": workbook.add_format(
            {
                **base,
                "font_color": COLORS["muted"],
                "bg_color": COLORS["faint"],
                "border": 1,
                "border_color": COLORS["line"],
                "text_wrap": True,
                "valign": "top",
            }
        ),
    }


def build_daily_workbook(workbook, formats, payload):
    store_name = payload.get("storeName") or "PDV"
    report = payload.get("report") or {}
    build_today_sheet(workbook, formats, store_name, report)
    for period in payload.get("periods") or []:
        build_period_sheet(workbook, formats, period)


def build_sales_history_workbook(workbook, formats, payload):
    store_name = payload.get("storeName") or "PDV"
    report = payload.get("report") or {}
    daily_rows = payload.get("dailyRows") or []
    build_history_summary_sheet(workbook, formats, store_name, report, daily_rows)
    build_product_payment_sheet(workbook, formats, store_name, report)
    build_products_sheet(workbook, formats, store_name, report)


def prepare_sheet(sheet, tab_color=COLORS["blue"]):
    sheet.hide_gridlines(2)
    sheet.set_tab_color(tab_color)
    sheet.set_margins(left=0.35, right=0.35, top=0.5, bottom=0.5)
    sheet.set_footer("&L&P de &N&RPDV Sistema")


def write_title(sheet, formats, store_name, subtitle, last_col):
    sheet.merge_range(0, 0, 0, last_col, store_name, formats["title"])
    sheet.merge_range(1, 0, 1, last_col, subtitle, formats["subtitle"])
    sheet.set_row(0, 29)
    sheet.set_row(1, 22)


def write_section(sheet, formats, row, title, last_col):
    sheet.merge_range(row, 0, row, last_col, title, formats["section"])
    sheet.set_row(row, 23)
    return row + 1


def write_kpis(sheet, formats, row, items):
    col = 0
    for label, value, kind in items:
        sheet.merge_range(row, col, row, col + 1, label, formats["kpi_label"])
        fmt = {
            "money": formats["kpi_money"],
            "money_blue": formats["kpi_money_blue"],
            "money_green": formats["kpi_money_green"],
        }.get(kind, formats["kpi_value"])
        sheet.merge_range(row + 1, col, row + 1, col + 1, value, fmt)
        col += 2
    sheet.set_row(row, 20)
    sheet.set_row(row + 1, 25)
    return row + 3


def build_today_sheet(workbook, formats, store_name, report):
    sheet = workbook.add_worksheet("Hoje")
    prepare_sheet(sheet, COLORS["blue"])
    set_dashboard_columns(sheet)
    sheet.freeze_panes(6, 0)
    sheet.set_portrait()
    sheet.fit_to_pages(1, 0)

    totals = report.get("totals") or {}
    register = report.get("register") or {}
    items = report.get("items") or []
    items_by_payment = product_payment_rows(report)
    total_sales = num(totals.get("total_sales"))
    transactions = int(num(totals.get("transaction_count")))
    avg_ticket = total_sales / transactions if transactions else 0
    closing_cash = num(register.get("opening_balance")) + num(totals.get("total_cash"))

    write_title(sheet, formats, store_name, f"Fechamento de caixa - {format_pt_date(report.get('date'))}", 8)
    write_kpis(
        sheet,
        formats,
        3,
        [
            ("Total de vendas", total_sales, "money_blue"),
            ("Transacoes", transactions, "number"),
            ("Ticket medio", avg_ticket, "money"),
            ("Lucro", num(totals.get("profit")), "money_green"),
        ],
    )
    write_kpis(
        sheet,
        formats,
        7,
        [
            ("Custo dos produtos", num(totals.get("cost_total")), "money"),
            ("Desconto promocional", num(totals.get("promotion_discount")), "money"),
            ("Saldo de abertura", num(register.get("opening_balance")), "money"),
            ("Saldo final em caixa", closing_cash, "money_green"),
        ],
    )

    payment_rows = payment_summary_rows(totals)
    row = write_section(sheet, formats, 11, "Formas de pagamento", 8)
    write_table(
        sheet,
        formats,
        row,
        0,
        ["Forma", "Valor", "Participacao"],
        payment_rows,
        ["text", "money", "percent"],
        max_rows=3,
    )
    add_payment_chart(workbook, sheet, "Hoje", row, len(payment_rows), 4, 11)

    notes = report.get("closingNotes") or register.get("notes") or ""
    after_payment_visual = 27
    if notes:
        note_row = after_payment_visual
        sheet.merge_range(note_row, 0, note_row, 8, "Observacoes do fechamento", formats["section"])
        sheet.merge_range(note_row + 1, 0, note_row + 3, 8, str(notes)[:1000], formats["note"])
        after_payment_visual = note_row + 5

    product_start = after_payment_visual
    product_start = write_section(sheet, formats, product_start, "Produtos por forma de pagamento", 8)
    product_rows = [
        [
            i.get("product_name") or "",
            payment_label(i.get("payment_method")),
            num(i.get("quantity")),
            num(i.get("total")),
            int(num(i.get("transaction_count"))),
        ]
        for i in items_by_payment[:50]
    ]
    product_end = write_table(
        sheet,
        formats,
        product_start,
        0,
        ["Produto", "Pagamento", "Quantidade", "Receita", "Transacoes"],
        product_rows,
        ["text", "text", "quantity", "money", "number"],
        max_rows=50,
    )
    add_products_chart(workbook, sheet, "Hoje", product_start, aggregate_products(items_by_payment or items)[:10], 5, product_start)


def build_period_sheet(workbook, formats, period):
    label = period.get("label") or "Periodo"
    sheet_name = safe_sheet_name(label)
    sheet = workbook.add_worksheet(sheet_name)
    prepare_sheet(sheet, COLORS["green"])
    set_period_columns(sheet)
    sheet.freeze_panes(7, 0)
    sheet.set_landscape()
    sheet.fit_to_pages(1, 0)

    rows = period.get("rows") or []
    products = period.get("topProducts") or []
    items_by_payment = product_payment_rows(period)
    totals = period.get("totals") or {}
    transactions = int(num(totals.get("transactions")))
    avg_ticket = num(totals.get("total_sales")) / transactions if transactions else 0

    subtitle = f"{label} - {format_pt_date(period.get('startDate'))} a {format_pt_date(period.get('endDate'))}"
    write_title(sheet, formats, period.get("storeName") or "PDV", subtitle, 11)
    write_kpis(
        sheet,
        formats,
        3,
        [
            ("Total de vendas", num(totals.get("total_sales")), "money_blue"),
            ("Transacoes", transactions, "number"),
            ("Ticket medio", avg_ticket, "money"),
            ("Lucro", num(totals.get("profit")), "money_green"),
        ],
    )

    table_row = write_section(sheet, formats, 8, "Resumo diario", 11)
    daily_rows = [
        [
            format_pt_date(r.get("date")),
            num(r.get("total_sales")),
            num(r.get("cost_total")),
            num(r.get("profit")),
            int(num(r.get("transactions"))),
            num(r.get("avg_ticket")),
            num(r.get("cash")),
            num(r.get("card")),
            num(r.get("pix")),
        ]
        for r in rows
    ]
    daily_end = write_table(
        sheet,
        formats,
        table_row,
        0,
        ["Data", "Vendas", "Custo", "Lucro", "Transacoes", "Ticket medio", "Dinheiro", "Cartao", "PIX"],
        daily_rows,
        ["date", "money", "money", "profit", "number", "money", "money", "money", "money"],
        max_rows=60,
    )
    add_daily_chart(workbook, sheet, sheet_name, table_row, daily_rows, 9, 8)

    product_row = max(daily_end + 3, 27)
    product_row = write_section(sheet, formats, product_row, "Produtos por forma de pagamento", 11)
    product_rows = [
        [
            p.get("product_name") or "",
            payment_label(p.get("payment_method")),
            num(p.get("quantity")),
            num(p.get("total")),
            int(num(p.get("transaction_count"))),
        ]
        for p in items_by_payment[:80]
    ]
    write_table(
        sheet,
        formats,
        product_row,
        0,
        ["Produto", "Pagamento", "Quantidade", "Receita", "Transacoes"],
        product_rows,
        ["text", "text", "quantity", "money", "number"],
        max_rows=80,
    )
    add_products_chart(workbook, sheet, sheet_name, product_row, aggregate_products(items_by_payment or products)[:10], 5, product_row)


def build_history_summary_sheet(workbook, formats, store_name, report, daily_rows):
    sheet = workbook.add_worksheet("Resumo")
    prepare_sheet(sheet, COLORS["blue"])
    set_dashboard_columns(sheet)
    sheet.freeze_panes(6, 0)
    sheet.set_portrait()
    sheet.fit_to_pages(1, 0)

    totals = report.get("totals") or {}
    transactions = int(num(totals.get("transaction_count")))
    total_sales = num(totals.get("total_sales"))
    avg_ticket = total_sales / transactions if transactions else 0

    write_title(sheet, formats, store_name, f"Relatorio de vendas - {period_text(report)}", 8)
    write_kpis(
        sheet,
        formats,
        3,
        [
            ("Total de vendas", total_sales, "money_blue"),
            ("Transacoes", transactions, "number"),
            ("Ticket medio", avg_ticket, "money"),
            ("Lucro", num(totals.get("profit")), "money_green"),
        ],
    )

    row = write_section(sheet, formats, 8, "Formas de pagamento", 8)
    payment_rows = payment_summary_rows(totals)
    write_table(
        sheet,
        formats,
        row,
        0,
        ["Forma", "Valor", "Participacao"],
        payment_rows,
        ["text", "money", "percent"],
        max_rows=3,
    )
    add_payment_chart(workbook, sheet, "Resumo", row, len(payment_rows), 4, 8)

    trend_row = write_section(sheet, formats, 25, "Vendas por dia", 8)
    trend_rows = [
        [
            format_pt_date(r.get("date")),
            num(r.get("total_sales")),
            num(r.get("profit")),
            int(num(r.get("transactions"))),
            num(r.get("avg_ticket")),
        ]
        for r in daily_rows[:60]
    ]
    write_table(
        sheet,
        formats,
        trend_row,
        0,
        ["Data", "Vendas", "Lucro", "Transacoes", "Ticket medio"],
        trend_rows,
        ["date", "money", "profit", "number", "money"],
        max_rows=60,
    )
    add_daily_chart(workbook, sheet, "Resumo", trend_row, trend_rows, 5, 18)


def build_product_payment_sheet(workbook, formats, store_name, report):
    sheet = workbook.add_worksheet("Produtos Pgto")
    prepare_sheet(sheet, COLORS["green"])
    sheet.freeze_panes(5, 0)
    sheet.set_landscape()
    sheet.fit_to_pages(1, 0)
    widths = [34, 18, 16, 16, 16, 14, 10, 10, 10, 10]
    for index, width in enumerate(widths):
        sheet.set_column(index, index, width)

    write_title(sheet, formats, store_name, f"Produtos por pagamento - {period_text(report)}", 9)
    row = write_section(sheet, formats, 4, "Resumo por produto e forma de pagamento", 9)
    product_rows = [
        [
            i.get("product_name") or "",
            payment_label(i.get("payment_method")),
            num(i.get("quantity")),
            num(i.get("total")),
            ratio(i.get("total"), (report.get("totals") or {}).get("total_sales")),
            int(num(i.get("transaction_count"))),
        ]
        for i in product_payment_rows(report)
    ]
    end = write_table(
        sheet,
        formats,
        row,
        0,
        ["Produto", "Pagamento", "Quantidade", "Receita", "Participacao", "Transacoes"],
        product_rows,
        ["text", "text", "quantity", "money", "percent", "number"],
        max_rows=1000,
    )
    if product_rows:
        sheet.autofilter(row, 0, end, 5)


def build_products_sheet(workbook, formats, store_name, report):
    sheet = workbook.add_worksheet("Produtos")
    prepare_sheet(sheet, COLORS["orange"])
    sheet.freeze_panes(5, 0)
    sheet.set_portrait()
    sheet.fit_to_pages(1, 0)
    sheet.set_column(0, 0, 34)
    sheet.set_column(1, 4, 16)
    sheet.set_column(6, 8, 12)

    write_title(sheet, formats, store_name, f"Produtos vendidos - {period_text(report)}", 8)
    row = write_section(sheet, formats, 4, "Produtos por forma de pagamento", 8)
    product_rows = [
        [
            i.get("product_name") or "",
            payment_label(i.get("payment_method")),
            num(i.get("quantity")),
            num(i.get("total")),
            int(num(i.get("transaction_count"))),
        ]
        for i in product_payment_rows(report)[:80]
    ]
    write_table(
        sheet,
        formats,
        row,
        0,
        ["Produto", "Pagamento", "Quantidade", "Receita", "Transacoes"],
        product_rows,
        ["text", "text", "quantity", "money", "number"],
        max_rows=80,
    )
    add_products_chart(workbook, sheet, "Produtos", row, aggregate_products(product_payment_rows(report))[:12], 5, 5)


def write_table(sheet, formats, row, col, headers, rows, kinds, max_rows=100):
    for offset, header in enumerate(headers):
        sheet.write(row, col + offset, header, formats["table_header"])
    sheet.set_row(row, 22)

    visible_rows = rows[:max_rows]
    if not visible_rows:
        sheet.merge_range(row + 1, col, row + 2, col + len(headers) - 1, "Sem dados para o periodo.", formats["empty"])
        return row + 2

    for r_offset, values in enumerate(visible_rows, start=1):
        is_alt = r_offset % 2 == 0
        for c_offset, value in enumerate(values):
            kind = kinds[c_offset] if c_offset < len(kinds) else "text"
            sheet.write(row + r_offset, col + c_offset, value, cell_format(formats, kind, value, is_alt))
        sheet.set_row(row + r_offset, 21)
    return row + len(visible_rows)


def cell_format(formats, kind, value, is_alt):
    if kind == "money":
        return formats["money_alt"] if is_alt else formats["money"]
    if kind == "money_blue":
        return formats["money_blue"]
    if kind == "number":
        return formats["number_alt"] if is_alt else formats["number"]
    if kind == "quantity":
        return formats["quantity"]
    if kind == "percent":
        return formats["percent"]
    if kind == "date":
        return formats["body_center_alt"] if is_alt else formats["body_center"]
    if kind == "profit":
        return formats["money_green"] if num(value) >= 0 else formats["money_red"]
    return formats["body_alt"] if is_alt else formats["body"]


def add_payment_chart(workbook, sheet, sheet_name, table_row, row_count, col, row):
    if row_count <= 0:
        return
    chart = workbook.add_chart({"type": "pie"})
    chart.add_series(
        {
            "name": "Formas de pagamento",
            "categories": [sheet_name, table_row + 1, 0, table_row + row_count, 0],
            "values": [sheet_name, table_row + 1, 1, table_row + row_count, 1],
            "points": [
                {"fill": {"color": COLORS["green"]}},
                {"fill": {"color": COLORS["blue"]}},
                {"fill": {"color": COLORS["orange"]}},
            ],
            "data_labels": {"percentage": True, "leader_lines": True},
        }
    )
    style_chart(chart, "Participacao por pagamento")
    chart.set_legend({"position": "right"})
    chart.set_size({"width": 410, "height": 245})
    sheet.insert_chart(row, col, chart, {"x_offset": 10, "y_offset": 0})


def add_products_chart(workbook, sheet, sheet_name, table_row, rows, col, row, value_col=3):
    if not rows:
        return
    chart = workbook.add_chart({"type": "bar"})
    last = table_row + len(rows)
    chart.add_series(
        {
            "name": "Receita",
            "categories": [sheet_name, table_row + 1, 0, last, 0],
            "values": [sheet_name, table_row + 1, value_col, last, value_col],
            "fill": {"color": COLORS["green"]},
            "border": {"color": COLORS["green"]},
        }
    )
    style_chart(chart, "Top produtos por receita")
    chart.set_x_axis({"num_format": '"R$" #,##0', "major_gridlines": {"visible": True, "line": {"color": "#E5E5EA"}}})
    chart.set_legend({"none": True})
    chart.set_size({"width": 420, "height": 290})
    sheet.insert_chart(row, col, chart, {"x_offset": 10, "y_offset": 0})


def add_daily_chart(workbook, sheet, sheet_name, table_row, rows, col, row):
    if not rows:
        return
    last = table_row + len(rows)
    chart = workbook.add_chart({"type": "line"})
    chart.add_series(
        {
            "name": "Vendas",
            "categories": [sheet_name, table_row + 1, 0, last, 0],
            "values": [sheet_name, table_row + 1, 1, last, 1],
            "line": {"color": COLORS["blue"], "width": 2.25},
            "marker": {"type": "circle", "size": 5, "border": {"color": COLORS["blue"]}, "fill": {"color": COLORS["white"]}},
        }
    )
    if len(rows[0]) > 2:
        chart.add_series(
            {
                "name": "Lucro",
                "categories": [sheet_name, table_row + 1, 0, last, 0],
                "values": [sheet_name, table_row + 1, 2, last, 2],
                "line": {"color": COLORS["green"], "width": 2.0},
                "marker": {"type": "circle", "size": 5, "border": {"color": COLORS["green"]}, "fill": {"color": COLORS["white"]}},
            }
        )
    style_chart(chart, "Evolucao diaria")
    chart.set_y_axis({"num_format": '"R$" #,##0', "major_gridlines": {"visible": True, "line": {"color": "#E5E5EA"}}})
    chart.set_legend({"position": "bottom"})
    chart.set_size({"width": 430, "height": 260})
    sheet.insert_chart(row, col, chart, {"x_offset": 10, "y_offset": 0})


def style_chart(chart, title):
    chart.set_title({"name": title, "name_font": {"name": "Aptos", "size": 11, "bold": True, "color": COLORS["ink"]}})
    chart.set_style(10)
    chart.set_chartarea({"border": {"none": True}, "fill": {"color": COLORS["white"]}})
    chart.set_plotarea({"border": {"none": True}, "fill": {"color": COLORS["white"]}})
    chart.set_x_axis({"label_position": "low", "num_font": {"name": "Aptos", "size": 8, "color": COLORS["muted"]}})
    chart.set_y_axis({"num_font": {"name": "Aptos", "size": 8, "color": COLORS["muted"]}})


def set_dashboard_columns(sheet):
    widths = [18, 16, 16, 16, 18, 16, 16, 16, 16]
    for index, width in enumerate(widths):
        sheet.set_column(index, index, width)


def set_period_columns(sheet):
    widths = [14, 14, 14, 14, 12, 14, 14, 14, 14, 2, 14, 14]
    for index, width in enumerate(widths):
        sheet.set_column(index, index, width)


def payment_summary_rows(totals):
    total = num(totals.get("total_sales"))
    return [
        ["Dinheiro", num(totals.get("total_cash")), ratio(totals.get("total_cash"), total)],
        ["Cartao", num(totals.get("total_card")), ratio(totals.get("total_card"), total)],
        ["PIX", num(totals.get("total_pix")), ratio(totals.get("total_pix"), total)],
    ]


def product_payment_rows(source):
    rows = source.get("itemsByPayment") or []
    if not rows:
        rows = [{**item, "payment_method": "", "transaction_count": ""} for item in source.get("items") or []]
    return sorted(
        rows,
        key=lambda item: (str(item.get("product_name") or "").casefold(), -num(item.get("total"))),
    )


def aggregate_products(rows):
    totals = {}
    for item in rows or []:
        name = item.get("product_name") or ""
        if not name:
            continue
        current = totals.setdefault(name, {"product_name": name, "quantity": 0, "total": 0})
        current["quantity"] += num(item.get("quantity"))
        current["total"] += num(item.get("total"))
    return sorted(totals.values(), key=lambda item: num(item.get("total")), reverse=True)


def safe_sheet_name(value):
    name = str(value or "Planilha").replace(":", " ").replace("/", " ").replace("\\", " ")
    name = name.replace("?", " ").replace("*", " ").replace("[", " ").replace("]", " ").strip()
    return (name or "Planilha")[:31]


def period_text(report):
    start = report.get("startDate")
    end = report.get("endDate")
    if start and end:
        return f"{format_pt_date(start)} a {format_pt_date(end)}"
    if report.get("date"):
        return format_pt_date(report.get("date"))
    return datetime.now().strftime("%d/%m/%Y")


def format_pt_date(value):
    if not value:
        return ""
    parts = str(value).split("-")
    if len(parts) == 3:
        return f"{parts[2]}/{parts[1]}/{parts[0]}"
    return str(value)


def format_time(value):
    if not value:
        return ""
    return str(value)[:5]


def payment_label(value):
    return {"cash": "Dinheiro", "card": "Cartao", "pix": "PIX"}.get(value, value or "")


def status_label(value):
    return {"completed": "Concluida", "cancelled": "Cancelada"}.get(value, value or "")


def ratio(value, total):
    total = num(total)
    return num(value) / total if total else 0


def num(value):
    try:
        if value is None or value == "":
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0


if __name__ == "__main__":
    sys.exit(main())
