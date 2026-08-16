import re
import json

schema_path = '/Users/hamdy/development/Mafhooom/backend/asas_backend/prisma/schema.prisma'

with open(schema_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

models = []
current_model = None

for line in lines:
    line_str = line.strip()
    if line_str.startswith('model '):
        model_name = line_str.split(' ')[1]
        current_model = {
            'name': model_name,
            'table': model_name.lower(),
            'pks': [],
            'uniques': [],
            'indexes': []
        }
        models.append(current_model)
    elif line_str.startswith('@@map('):
        m = re.search(r'@@map\("([^"]+)"\)', line_str)
        if m and current_model:
            current_model['table'] = m.group(1)
    elif current_model:
        if line_str.startswith('}'):
            current_model = None
        else:
            if line_str.startswith('@@unique('):
                m = re.search(r'@@unique\(\[([^\]]+)\](?:,\s*map:\s*"([^"]+)")?\)', line_str)
                if m:
                    fields = re.sub(r'\s+', '', m.group(1))
                    name = m.group(2) if m.group(2) else None
                    current_model['uniques'].append({'fields': fields, 'name': name, 'type': '@@unique'})
            elif line_str.startswith('@@index('):
                m = re.search(r'@@index\(\[([^\]]+)\](?:,\s*map:\s*"([^"]+)")?\)', line_str)
                if m:
                    fields = re.sub(r'\s+', '', m.group(1))
                    name = m.group(2) if m.group(2) else None
                    current_model['indexes'].append({'fields': fields, 'name': name, 'type': '@@index'})
            elif not line_str.startswith('//') and len(line_str) > 0:
                parts = line_str.split()
                field_name = parts[0]
                if '@id' in line_str:
                    current_model['pks'].append(field_name)
                if '@unique' in line_str:
                    current_model['uniques'].append({'fields': field_name, 'name': None, 'type': '@unique'})

# Print summary statistics
print(f"Total Models: {len(models)}")
total_pks = sum(len(m['pks']) for m in models)
total_uniques = sum(len(m['uniques']) for m in models)
total_indexes = sum(len(m['indexes']) for m in models)
print(f"Primary Keys: {total_pks}")
print(f"Unique Constraints: {total_uniques}")
print(f"Indexes (@@index): {total_indexes}")
print(f"Total: {total_pks + total_uniques + total_indexes}\n")

for idx, m in enumerate(models, 1):
    print(f"## {idx}. {m['name']} (`{m['table']}`)\n")
    print("| النوع | الأعمدة | الاسم | الغرض |")
    print("|-------|---------|-------|-------|")
    for pk in m['pks']:
        print(f"| PK | `{pk}` | — | 主键 / Primary Key |")
    for u in m['uniques']:
        name_str = f"`{u['name']}`" if u['name'] else "—"
        print(f"| Unique | `{u['fields']}` | {name_str} | قيد فريد |")
    for i in m['indexes']:
        name_str = f"`{i['name']}`" if i['name'] else "—"
        print(f"| Index | `{i['fields']}` | {name_str} | فهرس بحث |")
    print("\n---")

