"""Build a source archive from an explicit allowlist; never package local credentials."""
from pathlib import Path
import hashlib,json,re,zipfile
root=Path(__file__).resolve().parents[1]
paths=[]
for name in ['src','contracts','scripts','test','public']:
    paths.extend(p for p in (root/name).rglob('*') if p.is_file() and p.suffix not in ['.zip','.pyc'] and '__pycache__' not in p.parts)
for name in ['README.md','PRODUCT.md','DESIGN.md','LICENSE','package.json','package-lock.json','skills-lock.json','index.html','vite.config.ts','tsconfig.json','.env.example','.gitignore','.impeccable/design.json','docs/user-guide.md','docs/operations.md','docs/hire-agent.md','docs/x-pay-paths.md','docs/private-giving.md','docs/panels-direction.md','docs/agent-pay-direction.md','docs/agent-pay-technical.md','docs/motion-spec.md','docs/direction.md','docs/architecture.md','docs/provenance.md','docs/verification.md','docs/logo-prompt.txt','deployments/inspection.json','deployments/verification.json']:
    p=root/name
    if p.is_file(): paths.append(p)
paths.extend(sorted((root/'deploy/systemd').glob('*.service')))
paths=sorted(set(paths))
secrets=[]
if (root/'.env').exists():
    for line in (root/'.env').read_text().splitlines():
        if '=' not in line or line.lstrip().startswith('#'):continue
        key,value=line.split('=',1);value=value.strip().strip('\"\'')
        if re.search(r'PRIVATE_KEY|API_KEY|BINANCE_PAY_KEY|GIVING_STORE_KEY|X_TAX_SEED|BEARER_TOKEN|SECRET|PASSWORD|JWT',key) and len(value)>=8:secrets.append(value.encode())
for path in paths:
    relative=path.relative_to(root)
    if '.env'==relative.name or 'private' in relative.parts or 'node_modules' in relative.parts:raise SystemExit('Forbidden path in archive: '+str(relative))
    data=path.read_bytes()
    if any(secret in data for secret in secrets):raise SystemExit('Sensitive content found: '+str(relative))
output=root/'public/dark-genesis-source.zip'
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for path in paths:archive.write(path,'dark-genesis/'+str(path.relative_to(root)))
report={'file':output.name,'bytes':output.stat().st_size,'files':len(paths),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'secretScan':'passed'}
(root/'work').mkdir(exist_ok=True)
(root/'work/package.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
