# Verify index.html
with open(r'D:\Foodhubbie Project\Admin\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

checks = [
    ('tab-lostSales', 'tab content'),
    ('btnClearLostSales', 'clear button'),
    ('lostSalesOutletFilter', 'outlet filter'),
    ('lostSalesTotalRevenue', 'revenue badge'),
    ('lostSalesCount', 'count badge'),
    ('lostSalesTable', 'table'),
    ('data-tab="lostSales"', 'sidebar nav'),
]

for term, desc in checks:
    found = term in content
    status = 'REMAINS' if found else 'REMOVED'
    print(f'{status}: {desc} ({term})')

# Verify database.rules.json
with open(r'D:\Foodhubbie Project\database.rules.json', 'r', encoding='utf-8') as f:
    rules = f.read()

print()
rules_checks = [
    ('"lostSales"', 'root-level rules'),
    ('"lostSales":', 'outlet-level rules'),
]
for term, desc in rules_checks:
    found = term in rules
    status = 'REMAINS' if found else 'REMOVED'
    print(f'{status}: {desc}')