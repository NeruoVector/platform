"""Import official Nongshim snack metadata/photos without inventing store stock."""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from html.parser import HTMLParser
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

SHOP = 'https://enongshim.co.kr'
MAX_IMAGE = 1024 * 1024


def clean_product_name(name: str) -> str:
    """Keep product weights while removing manufacturer carton quantities."""
    return re.sub(r'\s*[*×＊]\s*\d+\s*(?:팩|봉|개|입|박스|세트)?', '', name).strip()


class CatalogError(Exception):
    """An official catalog response cannot safely be imported."""


class Metadata(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.values: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == 'meta' and values.get('property') and values.get('content'):
            self.values[str(values['property'])] = str(values['content'])


@dataclass(frozen=True)
class Snack:
    code: str
    name: str
    price: int
    page: str
    image: str
    mime: str
    image_bytes: bytes


def download(url: str, limit: int) -> bytes:
    with urlopen(Request(url, headers={'User-Agent': 'NeuroVector-Catalog/1.0'}), timeout=25) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise CatalogError(f'Response exceeds size limit: {url}')
    return content


def snack(code: str) -> Snack:
    page = f'{SHOP}/product/detail.html?product_no={code}'
    parser = Metadata()
    parser.feed(download(page, 3_000_000).decode('utf-8'))
    values = parser.values
    name = clean_product_name(values['og:title'].removesuffix(' - 농심몰'))
    price = int(values['product:price:amount'])
    image = values['og:image']
    parsed = urlsplit(image)
    if parsed.scheme != 'https' or parsed.hostname != 'enongshim.co.kr' or price < 0 or not name:
        raise CatalogError(f'Invalid official metadata for product {code}')
    content = download(image, MAX_IMAGE)
    if content.startswith(b'\xff\xd8\xff'):
        mime = 'image/jpeg'
    elif content.startswith(b'\x89PNG\r\n\x1a\n'):
        mime = 'image/png'
    elif content.startswith(b'RIFF') and content[8:12] == b'WEBP':
        mime = 'image/webp'
    else:
        raise CatalogError(f'Unsupported photo for {code}')
    return Snack(code, name, price, page, image, mime, content)


def main() -> None:
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--limit', type=int, default=24)
    args.add_argument('--api', default='http://127.0.0.1:18081')
    args.add_argument('--report', type=Path, default=Path('runtime/qa/snack-import.json'))
    config = args.parse_args()
    if urlsplit(config.api).hostname not in {'127.0.0.1', 'localhost'}:
        raise CatalogError('Importer credentials may only be sent to the local backend')
    cookie = ''

    def api(path: str, body: dict[str, str | int | bool] | None = None) -> object:
        nonlocal cookie
        headers = {'Content-Type': 'application/json'}
        if cookie:
            headers['Cookie'] = cookie
        data = None if body is None else json.dumps(body).encode()
        with urlopen(Request(config.api + path, data=data, headers=headers), timeout=20) as response:
            if path.endswith('/login'):
                session = SimpleCookie()
                session.load(response.headers.get('Set-Cookie', ''))
                cookie = '; '.join(f'{key}={value.value}' for key, value in session.items())
            content = response.read()
            return json.loads(content) if content else None

    listing = download(f'{SHOP}/product/list.html?cate_no=44', 3_000_000).decode('utf-8')
    codes = list(dict.fromkeys(re.findall(r'id="anchorBoxId_(\d+)"', listing)))[:max(1, min(config.limit, 100))]
    if not codes:
        raise CatalogError('Official snack category is empty; no inventory changes made')
    with ThreadPoolExecutor(max_workers=4) as pool:
        products = list(pool.map(snack, codes))
    api('/api/v1/admin/auth/login', {'username': os.environ['ADMIN_USERNAME'], 'password': os.environ['ADMIN_PASSWORD']})
    inventory = api('/api/v1/inventory?limit=500')
    if not isinstance(inventory, list):
        raise CatalogError('Invalid inventory response')
    photos = api('/api/v1/inventory/photos')
    known_photos = {entry['item_id'] for entry in photos} if isinstance(photos, list) else set()
    records = []
    existing_asset_photos = []
    try:
        for product in products:
            sku = f'NSHOP-{product.code}'
            existing = next((item for item in inventory if item['sku'] == sku or item['name'] == product.name
                             or (product.code == '2742' and item['name'] == '새우깡')), None)
            item = existing or api('/api/v1/inventory', {'sku': sku, 'name': product.name,
                'unit_price': product.price, 'currency': 'KRW', 'stock_quantity': 0,
                'active': True, 'description': '농심 · 스낵'})
            if not isinstance(item, dict):
                raise CatalogError('Invalid created inventory item')
            if item['id'] not in known_photos:
                encoded = base64.b64encode(product.image_bytes).decode()
                api(f"/api/v1/inventory/{item['id']}/photo", {'image_data_url': f'data:{product.mime};base64,{encoded}'})
            records.append({'item_id': item['id'], 'name': item['name'], 'created': existing is None,
                            'source': product.page, 'image_source': product.image})
        assets = Path(__file__).resolve().parents[2] / 'frontend/src/assets'
        for item in inventory:
            if not item['active'] or item['id'] in known_photos:
                continue
            asset = next((filename for prefix, filename in [
                ('NV-CHIP-', 'product-chips.png'), ('NV-GRAPE-', 'product-jelly.png'),
                ('NV-JELLY-', 'product-jelly.png'), ('NV-CHOCO-', 'product-milk.png'),
                ('NV-MILK-', 'product-milk.png'),
            ] if item['sku'].startswith(prefix)), None)
            if asset is not None:
                content = (assets / asset).read_bytes()
                if len(content) > MAX_IMAGE:
                    raise CatalogError('Existing project image exceeds upload limit')
                encoded = base64.b64encode(content).decode()
                api(f"/api/v1/inventory/{item['id']}/photo", {'image_data_url': f'data:image/png;base64,{encoded}'})
                existing_asset_photos.append({'item_id': item['id'], 'image_source': str(assets / asset)})
    finally:
        api('/api/v1/admin/auth/logout', {})
        config.report.parent.mkdir(parents=True, exist_ok=True)
        config.report.write_text(json.dumps({'source': SHOP, 'stock_policy': 'new items start at zero; existing sales data preserved', 'records': records, 'existing_asset_photos': existing_asset_photos}, ensure_ascii=False, indent=2))
    print(f'Imported {len(records)} official snacks/photos; existing inventory preserved')


if __name__ == '__main__':
    main()
