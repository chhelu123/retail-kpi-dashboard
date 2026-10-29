"""
Synthetic data generator for the Retail Sales KPI Dashboard.

Creates ~20,000 order-line rows for a fictional Indian multi-region
retail / e-commerce company ("BharatMart") for Jan 2023 - Dec 2025.

Realism built in:
  * ~20% year-on-year growth trend
  * Seasonality: Diwali festive spike (actual Diwali dates per year),
    Republic Day & Independence Day sales, year-end sale, monsoon dip
  * Deeper discounts in festive windows -> thinner (sometimes negative) margins
  * UPI share rising over time, COD falling
  * Delivery days depend on region; returns depend on category & channel
  * Customers are tied to a home city & segment and make repeat purchases

Outputs (in this folder):
  orders.csv   - full flat dataset (one row per order line)
  orders.json  - compact, dictionary-encoded copy loaded by the dashboard

Run:  py data/generate_data.py
"""
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
N_ORDERS = 13_500           # orders; each has 1-3 lines -> ~20k rows
N_CUSTOMERS = 4_200
START, END = date(2023, 1, 1), date(2025, 12, 31)
OUT = Path(__file__).resolve().parent
rng = np.random.default_rng(SEED)

# ----------------------------------------------------------------- geography
GEO = {  # region -> state -> [cities]
    "North":   {"Delhi": ["New Delhi"], "Uttar Pradesh": ["Lucknow", "Noida"],
                "Haryana": ["Gurugram"], "Punjab": ["Ludhiana"], "Rajasthan": ["Jaipur"]},
    "West":    {"Maharashtra": ["Mumbai", "Pune", "Nagpur"], "Gujarat": ["Ahmedabad", "Surat"],
                "Goa": ["Panaji"]},
    "South":   {"Karnataka": ["Bengaluru", "Mysuru"], "Tamil Nadu": ["Chennai", "Coimbatore"],
                "Telangana": ["Hyderabad"], "Kerala": ["Kochi"], "Andhra Pradesh": ["Visakhapatnam"]},
    "East":    {"West Bengal": ["Kolkata"], "Odisha": ["Bhubaneswar"], "Bihar": ["Patna"],
                "Assam": ["Guwahati"]},
    "Central": {"Madhya Pradesh": ["Indore", "Bhopal"], "Chhattisgarh": ["Raipur"]},
}
# relative demand weight of each city (metros heavier)
CITY_W = {"New Delhi": 9, "Lucknow": 3, "Noida": 3, "Gurugram": 4, "Ludhiana": 2, "Jaipur": 3,
          "Mumbai": 10, "Pune": 5, "Nagpur": 2, "Ahmedabad": 4, "Surat": 3, "Panaji": 1,
          "Bengaluru": 9, "Mysuru": 1.5, "Chennai": 6, "Coimbatore": 2, "Hyderabad": 6,
          "Kochi": 2, "Visakhapatnam": 1.5, "Kolkata": 5, "Bhubaneswar": 1.5, "Patna": 1.5,
          "Guwahati": 1.2, "Indore": 2, "Bhopal": 1.5, "Raipur": 1}
BASE_DELIVERY = {"North": 3.0, "West": 2.6, "South": 2.9, "East": 4.3, "Central": 3.8}
cities = [(r, s, c) for r, st in GEO.items() for s, cs in st.items() for c in cs]

# ------------------------------------------------------------------ products
# category -> sub-category -> [(product, base price ₹, cost ratio)]
CATALOG = {
    "Electronics": {
        "Mobiles":     [("Redmi Note 13 5G", 18999, .86), ("Samsung Galaxy M35", 21999, .87),
                        ("iPhone 15 128GB", 69900, .90), ("OnePlus Nord CE4", 24999, .86)],
        "Laptops":     [("HP 15s Ryzen 5", 45990, .88), ("Lenovo IdeaPad Slim 3", 52990, .88),
                        ("ASUS Vivobook 15", 38990, .87), ("MacBook Air M2", 99900, .91)],
        "Audio":       [("boAt Airdopes 141", 1299, .55), ("JBL Tune 760NC", 5999, .68),
                        ("Sony WH-1000XM5", 29990, .80), ("Noise Buds VS104", 1099, .55)],
        "Accessories": [("Mi 20000mAh Power Bank", 2199, .62), ("Portronics Charger 65W", 1499, .55),
                        ("SanDisk 128GB Pendrive", 999, .60), ("Logitech M331 Mouse", 899, .58)],
    },
    "Fashion": {
        "Men's Wear":   [("Levi's 511 Jeans", 2999, .48), ("Allen Solly Formal Shirt", 1799, .45),
                         ("Peter England Blazer", 5999, .50)],
        "Women's Wear": [("W Kurta Set", 2499, .45), ("Biba Anarkali Dress", 3499, .46),
                         ("Only Denim Jacket", 2999, .48)],
        "Ethnic Wear":  [("Banarasi Silk Saree", 7999, .52), ("Manyavar Kurta Pyjama", 4499, .50),
                         ("Lehenga Choli", 12999, .55)],
        "Footwear":     [("Bata Formal Shoes", 2499, .52), ("Nike Revolution 6", 3695, .58),
                         ("Campus Running Shoes", 1499, .50)],
    },
    "Home & Kitchen": {
        "Kitchen Appliances": [("Prestige Induction Cooktop", 2899, .66), ("Philips Mixer Grinder 750W", 3999, .68),
                               ("Kent RO Purifier", 15999, .72), ("Bajaj Air Fryer", 6499, .70)],
        "Cookware":           [("Hawkins Pressure Cooker 5L", 2199, .60), ("Pigeon Non-stick Set", 1599, .58),
                               ("Milton Steel Bottle Set", 899, .55)],
        "Furniture":          [("Wakefit Orthopedic Mattress", 13999, .70), ("Nilkamal Study Table", 5999, .72),
                               ("Green Soul Office Chair", 11999, .74)],
        "Home Decor":         [("Jaipuri Cotton Bedsheet", 1299, .45), ("Diwali Diya & Lights Set", 799, .40),
                               ("Wall Clock Designer", 1499, .50)],
    },
    "Grocery": {
        "Staples":   [("India Gate Basmati 5kg", 899, .82), ("Fortune Sunflower Oil 5L", 799, .86),
                      ("Aashirvaad Atta 10kg", 549, .85)],
        "Snacks":    [("Haldiram's Namkeen Combo", 499, .70), ("Dry Fruits Gift Box", 1499, .65),
                      ("Cadbury Celebrations Pack", 699, .72)],
        "Beverages": [("Tata Tea Gold 1kg", 599, .78), ("Nescafe Classic 200g", 649, .76),
                      ("Paper Boat Juice Pack", 399, .68)],
    },
    "Beauty & Personal Care": {
        "Skincare": [("Mamaearth Face Wash Combo", 599, .45), ("Minimalist Serum Kit", 1199, .42),
                     ("Lakme Sunscreen SPF50", 449, .48)],
        "Haircare": [("Dyson-style Hair Dryer", 3999, .65), ("Indulekha Hair Oil", 432, .50),
                     ("L'Oreal Shampoo + Conditioner", 699, .52)],
        "Grooming": [("Philips Trimmer BT3221", 1799, .62), ("Bombay Shaving Kit", 999, .48)],
    },
}
CAT_W = {"Electronics": .26, "Fashion": .26, "Home & Kitchen": .18, "Grocery": .17,
         "Beauty & Personal Care": .13}
products = [(c, s, p, price, cr) for c, subs in CATALOG.items() for s, items in subs.items()
            for (p, price, cr) in items]

SEGMENTS = ["Consumer", "Corporate", "Small Business"]
SEG_W = [.68, .18, .14]
CHANNELS = ["Website", "Mobile App", "Marketplace", "Retail Store"]
PAYMENTS = ["UPI", "Credit Card", "Debit Card", "Net Banking", "Cash on Delivery", "EMI / Wallet"]

DIWALI = {2023: date(2023, 11, 12), 2024: date(2024, 11, 1), 2025: date(2025, 10, 20)}


# ----------------------------------------------------------- daily intensity
def day_weight(d: date) -> float:
    t = (d - START).days / 365.25
    w = 1.20 ** t                                   # ~20% YoY growth
    w *= 1.12 if d.weekday() >= 5 else 1.0          # weekend lift
    dd = (DIWALI[d.year] - d).days
    if 0 <= dd <= 21:                               # 3-week Diwali rush
        w *= 2.6 - dd * 0.05
    elif -5 <= dd < 0:
        w *= 1.4
    if d.month == 1 and 18 <= d.day <= 26:          # Republic Day sale
        w *= 1.6
    if d.month == 8 and 8 <= d.day <= 15:           # Independence Day sale
        w *= 1.5
    if d.month == 12 and d.day >= 20:               # year-end sale
        w *= 1.35
    if d.month in (6, 7):                           # monsoon dip
        w *= 0.85
    if d.month == 3:                                # financial-year-end corporate buying
        w *= 1.08
    return w


def festive(d: date) -> bool:
    dd = (DIWALI[d.year] - d).days
    return (-5 <= dd <= 21) or (d.month == 1 and 18 <= d.day <= 26) or \
           (d.month == 8 and 8 <= d.day <= 15) or (d.month == 12 and d.day >= 20)


days = [START + timedelta(n) for n in range((END - START).days + 1)]
dw = np.array([day_weight(d) for d in days])
order_days = rng.choice(len(days), size=N_ORDERS, p=dw / dw.sum())
order_days.sort()

# ----------------------------------------------------------------- customers
city_w = np.array([CITY_W[c] for _, _, c in cities])
cust_city = rng.choice(len(cities), size=N_CUSTOMERS, p=city_w / city_w.sum())
cust_seg = rng.choice(len(SEGMENTS), size=N_CUSTOMERS, p=SEG_W)
cust_activity = rng.pareto(2.2, N_CUSTOMERS) + 0.3      # a few heavy repeat buyers

# category -> product index list
by_cat = {c: [i for i, p in enumerate(products) if p[0] == c] for c in CATALOG}
cat_names = list(CATALOG)
cat_p = np.array([CAT_W[c] for c in cat_names])

rows = []
for k, di in enumerate(order_days):
    d = days[di]
    fest = festive(d)
    cu = rng.choice(N_CUSTOMERS, p=cust_activity / cust_activity.sum())
    region, state, city = cities[cust_city[cu]]
    seg = SEGMENTS[cust_seg[cu]]
    order_id = f"BM-{d.year}-{k + 1:06d}"

    yr_frac = (d - START).days / (END - START).days
    ch_p = np.array([.30, .26 + .12 * yr_frac, .30, .14 - .06 * yr_frac])
    channel = CHANNELS[rng.choice(4, p=ch_p / ch_p.sum())]
    pay_p = np.array([.30 + .18 * yr_frac, .17, .13, .08, .22 - .14 * yr_frac, .10 - .04 * yr_frac])
    if channel == "Retail Store":
        pay_p[4] = 0.0
    payment = PAYMENTS[rng.choice(6, p=pay_p / pay_p.sum())]

    # delivery days (order level)
    base = BASE_DELIVERY[region] + (0.8 if fest else 0) - 0.6 * yr_frac
    if channel == "Retail Store":
        base = 1.2                                      # store pick-up / same-city dispatch
    ddays = int(max(1, round(rng.normal(base, 1.1))))

    n_lines = rng.choice([1, 2, 3], p=[.58, .30, .12])
    cp = cat_p.copy()
    if fest:                                            # festive basket mix
        cp = cp * np.array([1.25, 1.2, 1.15, .8, .9])
    if seg != "Consumer":
        cp = cp * np.array([1.6, .6, 1.2, 1.0, .5])
    for _ in range(n_lines):
        cat = cat_names[rng.choice(5, p=cp / cp.sum())]
        pi = rng.choice(by_cat[cat])
        c, sub, prod, price, cost_ratio = products[pi]
        # price drift ±4% and inflation ~5%/yr
        unit_price = round(price * (1 + rng.normal(0, .02)) * (1.05 ** (d.year - 2023)), 2)
        unit_cost = unit_price * cost_ratio * (1 + rng.normal(0, .03))
        if price > 20000:
            qty = int(rng.choice([1, 1, 1, 2]))
        else:
            qty = int(rng.choice([1, 1, 2, 2, 3, 4, 5]))
        if seg != "Consumer":
            qty = int(qty * rng.choice([1, 2, 3]))
        # discount ladder: deeper during sales, Fashion/Beauty discount more
        disc_choices = [0, .05, .10, .15, .20, .30, .40, .50]
        dp = np.array([.30, .20, .18, .12, .09, .06, .03, .02])
        if fest:
            dp = np.array([.08, .12, .20, .20, .17, .12, .07, .04])
        if c in ("Fashion", "Beauty & Personal Care"):
            dp = dp * np.array([.7, .8, 1, 1.1, 1.3, 1.5, 1.6, 1.6])
        discount = float(disc_choices[rng.choice(8, p=dp / dp.sum())])
        sales = round(qty * unit_price * (1 - discount), 2)
        cost = round(qty * unit_cost, 2)
        profit = round(sales - cost, 2)
        ret_p = {"Electronics": .045, "Fashion": .14, "Home & Kitchen": .06, "Grocery": .015,
                 "Beauty & Personal Care": .05}[c]
        ret_p *= {"Marketplace": 1.35, "Retail Store": .4, "Website": 1.0, "Mobile App": .95}[channel]
        returned = int(rng.random() < ret_p)
        rows.append(dict(order_date=d.isoformat(), order_id=order_id, region=region, state=state,
                         city=city, segment=seg, category=c, sub_category=sub, product=prod,
                         quantity=qty, unit_price=unit_price, discount=discount, sales=sales,
                         cost=cost, profit=profit, customer_id=f"CUST-{cu + 1:05d}",
                         channel=channel, payment_mode=payment, delivery_days=ddays,
                         returned=returned))

df = pd.DataFrame(rows)
df.to_csv(OUT / "orders.csv", index=False)

# --------------------------------------------- compact JSON for the browser
DIM_COLS = ["region", "state", "city", "segment", "category", "sub_category", "product",
            "channel", "payment_mode"]
dims = {c: sorted(df[c].unique().tolist()) for c in DIM_COLS}
idx = {c: {v: i for i, v in enumerate(dims[c])} for c in DIM_COLS}
d0 = pd.Timestamp(START)
cols = ["day", "order", "customer", *DIM_COLS, "quantity", "unit_price", "discount", "sales",
        "cost", "profit", "delivery_days", "returned"]
order_num = df["order_id"].str[-6:].astype(int)
cust_num = df["customer_id"].str[-5:].astype(int)
day_num = (pd.to_datetime(df["order_date"]) - d0).dt.days
packed = []
for i, r in enumerate(df.itertuples(index=False)):
    packed.append([int(day_num[i]), int(order_num[i]), int(cust_num[i]),
                   *[idx[c][getattr(r, c)] for c in DIM_COLS],
                   r.quantity, round(r.unit_price), r.discount, round(r.sales), round(r.cost),
                   round(r.profit), r.delivery_days, r.returned])
meta = {"start": START.isoformat(), "end": END.isoformat(), "rows": len(df),
        "source": "Synthetic - generated by data/generate_data.py (seed 42)"}
with open(OUT / "orders.json", "w", encoding="utf-8") as f:
    json.dump({"meta": meta, "dims": dims, "cols": cols, "rows": packed}, f,
              separators=(",", ":"), ensure_ascii=False)

print(f"rows={len(df):,} orders={df.order_id.nunique():,} customers={df.customer_id.nunique():,}")
print(f"revenue=₹{df.sales.sum() / 1e7:.2f} Cr  profit=₹{df.profit.sum() / 1e7:.2f} Cr  "
      f"margin={df.profit.sum() / df.sales.sum():.1%}")
print(df.groupby(df.order_date.str[:4]).sales.sum().div(1e7).round(2).to_string())
