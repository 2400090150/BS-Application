require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
const PORT = Number(process.env.PORT || 3000);
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const uploadsDir = path.join(dataDir, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const db = new Database(path.join(dataDir, "store.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL,
 customer_name TEXT NOT NULL,
 customer_email TEXT NOT NULL,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 description TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS reviews_status_created_idx ON reviews(status,created_at DESC);
CREATE TABLE IF NOT EXISTS contact_details (
 id INTEGER PRIMARY KEY CHECK(id=1),
 phone TEXT NOT NULL,
 email TEXT NOT NULL,
 address TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS admin_access_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_email TEXT NOT NULL,
 target_email TEXT NOT NULL,
 action TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, username TEXT, password_hash TEXT, google_sub TEXT UNIQUE, phone TEXT DEFAULT '', address TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS customer_addresses (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER NOT NULL,
 recipient_name TEXT NOT NULL,
 phone TEXT NOT NULL,
 house TEXT NOT NULL DEFAULT '',
 street TEXT NOT NULL DEFAULT '',
 city TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT '',
 pin_code TEXT NOT NULL DEFAULT '',
 country TEXT NOT NULL DEFAULT 'India',
 landmark TEXT NOT NULL DEFAULT '',
 label TEXT NOT NULL DEFAULT 'Home',
 is_default INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS password_resets (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS password_reset_otps (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER,
 email_hash TEXT NOT NULL,
 purpose TEXT NOT NULL DEFAULT 'password_reset',
 otp_hash TEXT NOT NULL DEFAULT '',
 reset_token_hash TEXT NOT NULL DEFAULT '',
 request_ip TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 used INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS password_reset_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 customer_id INTEGER,
 request_ip_hash TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending',
 requested_at INTEGER NOT NULL,
 approved_at INTEGER,
 code_hash TEXT NOT NULL DEFAULT '',
 code_expires_at INTEGER,
 attempts INTEGER NOT NULL DEFAULT 0,
 reset_token_hash TEXT NOT NULL DEFAULT '',
 reset_token_expires_at INTEGER,
 used INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS password_reset_otps_email_created ON password_reset_otps(email_hash,created_at);
CREATE INDEX IF NOT EXISTS password_reset_otps_ip_created ON password_reset_otps(request_ip,created_at);
CREATE INDEX IF NOT EXISTS password_reset_requests_customer ON password_reset_requests(customer_id,status,requested_at);
CREATE INDEX IF NOT EXISTS password_reset_requests_ip ON password_reset_requests(request_ip_hash,requested_at);
CREATE TABLE IF NOT EXISTS password_reset_attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_ip_hash TEXT NOT NULL,
 attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS password_reset_attempts_ip_time ON password_reset_attempts(request_ip_hash,attempted_at);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT NOT NULL,
 price REAL NOT NULL CHECK(price >= 0), offer_price REAL CHECK(offer_price IS NULL OR offer_price > 0), discount_percent INTEGER NOT NULL DEFAULT 0 CHECK(discount_percent BETWEEN 0 AND 100), description TEXT DEFAULT '', image TEXT DEFAULT '',
 stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0), featured INTEGER NOT NULL DEFAULT 0,
 out_of_stock INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categories (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL COLLATE NOCASE UNIQUE,
 sort_order INTEGER NOT NULL DEFAULT 0,
 image TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS collection_products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 product_id INTEGER NOT NULL UNIQUE,
 sort_order INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS homepage_shop_products (
 product_id INTEGER PRIMARY KEY,
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS homepage_shop_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 initialized INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO homepage_shop_settings(id,initialized) VALUES(1,0);
CREATE TABLE IF NOT EXISTS offer_banners (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 image TEXT NOT NULL DEFAULT '',
 button_text TEXT NOT NULL DEFAULT 'Shop offers',
 button_link TEXT NOT NULL DEFAULT '/products',
 start_date TEXT DEFAULT '',
 end_date TEXT DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1,
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS special_offer_products (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 product_id INTEGER NOT NULL UNIQUE,
 offer_price REAL NOT NULL CHECK(offer_price >= 0),
 offer_label TEXT DEFAULT '',
 start_date TEXT DEFAULT '',
 end_date TEXT DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1,
 sort_order INTEGER NOT NULL DEFAULT 0,
 featured INTEGER NOT NULL DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS site_images (
 key TEXT PRIMARY KEY,
 label TEXT NOT NULL,
 image TEXT NOT NULL,
 default_image TEXT NOT NULL DEFAULT '',
 previous_image TEXT NOT NULL DEFAULT '',
 sort_order INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS homepage_offer_banner (
 id INTEGER PRIMARY KEY CHECK(id=1),
 image TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO homepage_offer_banner(id,image,active) VALUES(1,'',0);
CREATE TABLE IF NOT EXISTS page_offer_banners (
 placement TEXT PRIMARY KEY CHECK(placement IN ('new-collection','offers')),
 image TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO page_offer_banners(placement,image,active)
VALUES('new-collection','',0),('offers','',0);
CREATE TABLE IF NOT EXISTS site_sections (
 key TEXT PRIMARY KEY,
 label TEXT NOT NULL,
 eyebrow TEXT NOT NULL DEFAULT '',
 heading TEXT NOT NULL DEFAULT '',
 heading_accent TEXT NOT NULL DEFAULT '',
 description TEXT NOT NULL DEFAULT '',
 button_text TEXT NOT NULL DEFAULT '',
 button_link TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1,
 sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, customer_name TEXT NOT NULL, email TEXT NOT NULL,
 phone TEXT NOT NULL, address TEXT NOT NULL, items_json TEXT NOT NULL, total REAL NOT NULL,
 payment_method TEXT NOT NULL DEFAULT 'Pay on delivery', payment_status TEXT NOT NULL DEFAULT 'Pending',
 status TEXT NOT NULL DEFAULT 'New', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 stock_deducted INTEGER NOT NULL DEFAULT 0, stock_restored INTEGER NOT NULL DEFAULT 0,
 restored_quantity INTEGER NOT NULL DEFAULT 0, cancellation_date TEXT,
 cancellation_reason TEXT NOT NULL DEFAULT '', shipped_at TEXT
);
CREATE TABLE IF NOT EXISTS order_status_updates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 status TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 changed_by TEXT NOT NULL DEFAULT 'admin',
 created_at TEXT NOT NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS order_stock_adjustments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 product_id INTEGER,
 product_name TEXT NOT NULL DEFAULT '',
 action TEXT NOT NULL,
 quantity INTEGER NOT NULL DEFAULT 0,
 reason TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS order_data_clear_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_email TEXT NOT NULL,
 deleted_orders INTEGER NOT NULL,
 created_at TEXT NOT NULL
);
`);
db.prepare("INSERT OR IGNORE INTO contact_details(id,phone,email,address) VALUES(1,?,?,?)")
  .run("+91 86880 12050","bs@handlooms.in","Hyderabad, India");
db.exec("UPDATE password_reset_requests SET status=UPPER(status)");
db.exec("UPDATE password_reset_requests SET status='REJECTED' WHERE status='VERIFIED'");
const authCustomerColumns = db.prepare("PRAGMA table_info(customers)").all().map(column => column.name);
if (!authCustomerColumns.includes("username")) db.exec("ALTER TABLE customers ADD COLUMN username TEXT");
if (!authCustomerColumns.includes("phone_verified_at")) db.exec("ALTER TABLE customers ADD COLUMN phone_verified_at TEXT");
const passwordOtpColumns = db.prepare("PRAGMA table_info(password_reset_otps)").all().map(column => column.name);
if (!passwordOtpColumns.includes("purpose")) db.exec("ALTER TABLE password_reset_otps ADD COLUMN purpose TEXT NOT NULL DEFAULT 'password_reset'");
if (!passwordOtpColumns.includes("reset_token_hash")) db.exec("ALTER TABLE password_reset_otps ADD COLUMN reset_token_hash TEXT NOT NULL DEFAULT ''");
db.exec("CREATE INDEX IF NOT EXISTS password_reset_otps_purpose_email ON password_reset_otps(purpose,email_hash,created_at)");
const customerAddressColumns = db.prepare("PRAGMA table_info(customer_addresses)").all().map(column => column.name);
if (!customerAddressColumns.includes("country")) db.exec("ALTER TABLE customer_addresses ADD COLUMN country TEXT NOT NULL DEFAULT 'India'");
const usernameRows = db.prepare("SELECT id,email,username FROM customers ORDER BY id").all();
const existingUsernames = new Set(usernameRows.map(row => String(row.username || "").toLowerCase()).filter(Boolean));
const updateUsername = db.prepare("UPDATE customers SET username=? WHERE id=?");
for (const row of usernameRows) {
  if (row.username) continue;
  const localPart = String(row.email || "").split("@")[0];
  let base = localPart.replace(/[^a-zA-Z0-9_.]/g, "").replace(/^[^a-zA-Z0-9]+/, "").slice(0, 24);
  if (base.length < 3) base = `user${row.id}`;
  let username = base;
  let suffix = 1;
  while (existingUsernames.has(username.toLowerCase())) {
    const ending = String(suffix++);
    username = `${base.slice(0, 30 - ending.length)}${ending}`;
  }
  updateUsername.run(username, row.id);
  existingUsernames.add(username.toLowerCase());
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS customers_username_unique ON customers(username COLLATE NOCASE); CREATE UNIQUE INDEX IF NOT EXISTS customers_email_unique_lower ON customers(email COLLATE NOCASE);");
const productColumns = db.prepare("PRAGMA table_info(products)").all().map(column => column.name);
if (!productColumns.includes("out_of_stock")) db.exec("ALTER TABLE products ADD COLUMN out_of_stock INTEGER NOT NULL DEFAULT 0");
if (!productColumns.includes("offer_price")) db.exec("ALTER TABLE products ADD COLUMN offer_price REAL");
if (!productColumns.includes("discount_percent")) db.exec("ALTER TABLE products ADD COLUMN discount_percent INTEGER NOT NULL DEFAULT 0");
db.exec(`
  UPDATE products
  SET discount_percent=MIN(100,MAX(1,CAST(ROUND((price-offer_price)*100.0/price) AS INTEGER)))
  WHERE offer_price IS NOT NULL AND offer_price>0 AND offer_price<price AND discount_percent=0;
`);
const defaultSiteImages = [
  ["homepage-hero","Homepage hero","https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1400&q=90"],
  ["homepage-craft","Homepage craftsmanship","https://images.unsplash.com/photo-1601924994987-69e26d50dc26?auto=format&fit=crop&w=1100&q=85"],
  ["homepage-collection","Homepage new collection banner","https://images.unsplash.com/photo-1583391733956-6c78276477e8?auto=format&fit=crop&w=1400&q=85"],
  ["homepage-special-offers","Homepage special offers banner","https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1400&q=85"],
  ["login-hero","Login page hero","https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1600&q=90"],
  ["account-hero","My Account background","https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=1600&q=90"],
  ["about-feature","About page feature","https://images.unsplash.com/photo-1583391733956-6c78276477e8?auto=format&fit=crop&w=1100&q=85"],
  ["categories-feature","Categories page feature","https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=1100&q=85"],
  ["image-fallback","Product image fallback","https://images.unsplash.com/photo-1601924994987-69e26d50dc26?auto=format&fit=crop&w=700&q=80"]
];
const logoPages = [
  ["home","Home page"],
  ["about","About page"],
  ["categories","Categories page"],
  ["contact","Contact page"],
  ["new-collection","New Collection page"],
  ["product","Product page"],
  ["products","Products page"],
  ["reviews","Reviews page"],
  ["special-offers","Special Offers page"],
  ["login","Sign-in page"],
  ["recovery","Password recovery page"],
  ["admin","Admin dashboard"]
];
const siteImageColumns = db.prepare("PRAGMA table_info(site_images)").all().map(column => column.name);
if (!siteImageColumns.includes("default_image")) db.exec("ALTER TABLE site_images ADD COLUMN default_image TEXT NOT NULL DEFAULT ''");
if (!siteImageColumns.includes("previous_image")) db.exec("ALTER TABLE site_images ADD COLUMN previous_image TEXT NOT NULL DEFAULT ''");
if (!siteImageColumns.includes("sort_order")) db.exec("ALTER TABLE site_images ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
const insertDefaultSiteImage = db.prepare("INSERT OR IGNORE INTO site_images(key,label,image,default_image,previous_image,sort_order) VALUES(?,?,?,?,?,?)");
defaultSiteImages.forEach((image,index) => {
  insertDefaultSiteImage.run(image[0],image[1],image[2],image[2],"",index);
  db.prepare("UPDATE site_images SET default_image=? WHERE key=? AND default_image=''").run(image[2],image[0]);
});
const sharedBrandLogo = db.prepare("SELECT image FROM site_images WHERE key='brand-logo'").get()?.image || "/brand-logo.png";
logoPages.forEach(([page,label],index) => {
  insertDefaultSiteImage.run(`brand-logo-${page}`,`Logo — ${label}`,sharedBrandLogo,"/brand-logo.png","",index-logoPages.length);
});
const defaultSiteSections = [
  ["hero","Homepage hero","THE BEAUTY OF THE HANDMADE","Tradition,\nwoven into\nevery thread.","woven into","Discover thoughtfully chosen handloom treasures that bring heritage, artistry and everyday elegance together.","Explore the collection","#shop",1,0],
  ["trust","Craft promise","","","","","","",1,1],
  ["shop","Featured products","FIND YOUR FAVOURITE","Shop the collection","","Handpicked pieces, made to stay with you.","Explore all products","/products",1,2],
  ["collection","New Collection","NEW ARRIVALS","New Collection","","Fresh handloom stories for the season ahead.","Explore New Collection","/new-collection",1,3],
  ["offers","Special Offers","SPECIAL OFFER SAREES","Handpicked sarees at exceptional value","","Seasonal pricing on signature pieces, without compromising craftsmanship.","View all offers","/special-offers",1,4],
  ["story","Our story","MORE THAN A FABRIC","Every weave has a story.","story.","Handloom carries the rhythm of skilled hands, the character of natural fibres and the beauty of traditions passed forward. At BS Handlooms, we celebrate textiles that feel personal, enduring and distinctly Indian.","Find your story","#shop",1,5],
  ["values","Our values","","","","","","",1,6],
  ["newsletter","Newsletter","A LITTLE NOTE FROM US","Good things are woven slowly.","woven slowly.","Keep in touch for new collections and stories from the world of handloom.","Join us","",1,7]
];
const insertDefaultSiteSection = db.prepare(`
  INSERT OR IGNORE INTO site_sections(key,label,eyebrow,heading,heading_accent,description,button_text,button_link,active,sort_order)
  VALUES(?,?,?,?,?,?,?,?,?,?)
`);
defaultSiteSections.forEach(section => insertDefaultSiteSection.run(...section));
// Backward-compatible schema migration for stores created before customer accounts.
const orderColumns = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
if (!orderColumns.includes("customer_id")) db.exec("ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id)");
if (!orderColumns.includes("stock_deducted")) {
  db.exec("ALTER TABLE orders ADD COLUMN stock_deducted INTEGER NOT NULL DEFAULT 0");
  db.exec("UPDATE orders SET stock_deducted=1");
}
if (!orderColumns.includes("stock_restored")) db.exec("ALTER TABLE orders ADD COLUMN stock_restored INTEGER NOT NULL DEFAULT 0");
if (!orderColumns.includes("restored_quantity")) db.exec("ALTER TABLE orders ADD COLUMN restored_quantity INTEGER NOT NULL DEFAULT 0");
if (!orderColumns.includes("cancellation_date")) db.exec("ALTER TABLE orders ADD COLUMN cancellation_date TEXT");
if (!orderColumns.includes("cancellation_reason")) db.exec("ALTER TABLE orders ADD COLUMN cancellation_reason TEXT NOT NULL DEFAULT ''");
if (!orderColumns.includes("shipped_at")) {
  db.exec("ALTER TABLE orders ADD COLUMN shipped_at TEXT");
  db.exec("UPDATE orders SET shipped_at=created_at WHERE status IN ('Shipped','Delivered')");
}
db.exec(`
  INSERT INTO order_status_updates(order_id,status,note,changed_by,created_at)
  SELECT id,status,'Order status recorded.','system',created_at
  FROM orders o
  WHERE NOT EXISTS (SELECT 1 FROM order_status_updates u WHERE u.order_id=o.id)
`);
db.exec("CREATE INDEX IF NOT EXISTS order_stock_adjustments_order_id ON order_stock_adjustments(order_id,created_at)");
const customerColumns = db.prepare("PRAGMA table_info(customers)").all().map(c => c.name);
if (!customerColumns.includes("updated_at")) db.exec("ALTER TABLE customers ADD COLUMN updated_at TEXT");
db.exec("UPDATE customers SET updated_at=created_at WHERE updated_at IS NULL OR updated_at=''");
db.exec(`
  UPDATE customers SET created_at=replace(created_at,' ','T')||'Z' WHERE created_at GLOB '????-??-?? ??:??:??';
  UPDATE customers SET updated_at=replace(updated_at,' ','T')||'Z' WHERE updated_at GLOB '????-??-?? ??:??:??';
  UPDATE orders SET created_at=replace(created_at,' ','T')||'Z' WHERE created_at GLOB '????-??-?? ??:??:??';
  UPDATE customer_addresses SET created_at=replace(created_at,' ','T')||'Z' WHERE created_at GLOB '????-??-?? ??:??:??';
  UPDATE customer_addresses SET updated_at=replace(updated_at,' ','T')||'Z' WHERE updated_at GLOB '????-??-?? ??:??:??';
`);
const categoryColumns = db.prepare("PRAGMA table_info(categories)").all().map(column => column.name);
if (!categoryColumns.includes("image")) db.exec("ALTER TABLE categories ADD COLUMN image TEXT NOT NULL DEFAULT ''");
if (!categoryColumns.includes("description")) db.exec("ALTER TABLE categories ADD COLUMN description TEXT NOT NULL DEFAULT ''");
if (!categoryColumns.includes("active")) db.exec("ALTER TABLE categories ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
if (!categoryColumns.includes("created_at")) db.exec("ALTER TABLE categories ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
if (!categoryColumns.includes("updated_at")) db.exec("ALTER TABLE categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
db.exec("UPDATE categories SET created_at=CURRENT_TIMESTAMP WHERE created_at=''; UPDATE categories SET updated_at=CURRENT_TIMESTAMP WHERE updated_at='';");
const normalizeCategoryName = value => String(value || "").trim().replace(/\s+/g," ");
db.transaction(() => {
  const categoryRows = db.prepare("SELECT id,name FROM categories ORDER BY id").all();
  const groupedCategories = new Map();
  for (const category of categoryRows) {
    const canonicalName = normalizeCategoryName(category.name).toLowerCase();
    if (!groupedCategories.has(canonicalName)) groupedCategories.set(canonicalName,[]);
    groupedCategories.get(canonicalName).push(category);
  }
  for (const group of groupedCategories.values()) {
    const keeper = group[0];
    for (const duplicate of group.slice(1)) {
      db.prepare("UPDATE products SET category=? WHERE category=?").run(keeper.name,duplicate.name);
      db.prepare("DELETE FROM categories WHERE id=?").run(duplicate.id);
    }
    const normalizedName = normalizeCategoryName(keeper.name);
    if (normalizedName !== keeper.name) {
      db.prepare("UPDATE products SET category=? WHERE category=?").run(normalizedName,keeper.name);
      db.prepare("UPDATE categories SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(normalizedName,keeper.id);
    }
  }
})();
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS categories_normalized_name ON categories(lower(name))");
const legacyAddress = db.prepare(`
  INSERT INTO customer_addresses(customer_id,recipient_name,phone,street,label,is_default)
  SELECT c.id,c.name,COALESCE(c.phone,''),c.address,'Home',1
  FROM customers c
  WHERE TRIM(COALESCE(c.address,''))!=''
    AND NOT EXISTS (SELECT 1 FROM customer_addresses a WHERE a.customer_id=c.id)
`);
legacyAddress.run();
const count = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
const defaultCategories = [
  "Sarees","Clothing","Dupattas","Fabrics","Home & Living","Accessories",
  "Handloom Sarees","Silk Sarees","Cotton Sarees","Traditional Sarees","Designer Sarees","Bridal Sarees","Linen Sarees",
  "Handloom Dress Materials","Dupattas and Stoles","Handloom Fabrics","Blouses and Accessories","Other Handloom Products"
];
const addCategory = db.prepare("INSERT OR IGNORE INTO categories(name,sort_order) VALUES(?,?)");
defaultCategories.forEach((name,index) => addCategory.run(name,index));
db.prepare("SELECT DISTINCT category FROM products ORDER BY category COLLATE NOCASE").all()
  .forEach(({category},index) => addCategory.run(category,defaultCategories.length+index));
const categoryNamesByCanonical = new Map(db.prepare("SELECT name FROM categories").all()
  .map(({name}) => [normalizeCategoryName(name).toLowerCase(),name]));
const updateProductCategory = db.prepare("UPDATE products SET category=? WHERE id=?");
db.prepare("SELECT id,category FROM products").all().forEach(product => {
  const canonicalCategory = categoryNamesByCanonical.get(normalizeCategoryName(product.category).toLowerCase());
  if (canonicalCategory && canonicalCategory !== product.category) updateProductCategory.run(canonicalCategory,product.id);
});
const homepageShopSettings = db.prepare("SELECT initialized FROM homepage_shop_settings WHERE id=1").get();
if (!homepageShopSettings.initialized) {
  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO homepage_shop_products(product_id,sort_order)
      SELECT p.id,ROW_NUMBER() OVER (ORDER BY p.featured DESC,p.created_at DESC,p.id DESC)-1
      FROM products p
      JOIN categories c ON c.name=p.category AND c.active=1
      WHERE p.active=1
      ORDER BY p.featured DESC,p.created_at DESC,p.id DESC
      LIMIT 8
    `).run();
    db.prepare("UPDATE homepage_shop_settings SET initialized=1 WHERE id=1").run();
  })();
}
db.prepare(`
  DELETE FROM homepage_shop_products
  WHERE product_id IN (
    SELECT product_id FROM homepage_shop_products
    ORDER BY sort_order ASC,product_id ASC
    LIMIT -1 OFFSET 8
  )
`).run();
db.exec("UPDATE categories SET created_at=CURRENT_TIMESTAMP WHERE created_at=''; UPDATE categories SET updated_at=CURRENT_TIMESTAMP WHERE updated_at='';");
db.exec("CREATE INDEX IF NOT EXISTS products_category_idx ON products(category)");
const MAIN_ADMIN_EMAIL = String(process.env.MAIN_ADMIN_EMAIL || "rupeshravu@gmail.com").trim().toLowerCase();
const mainAdminCustomer = db.prepare("SELECT id FROM customers WHERE email=? COLLATE NOCASE").get(MAIN_ADMIN_EMAIL);
const adminColumns = db.prepare("PRAGMA table_info(admins)").all().map(column => column.name);
if (!adminColumns.includes("role")) db.exec("ALTER TABLE admins ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
if (!adminColumns.includes("granted_by")) db.exec("ALTER TABLE admins ADD COLUMN granted_by TEXT");
if (!adminColumns.includes("granted_at")) db.exec("ALTER TABLE admins ADD COLUMN granted_at TEXT");
db.prepare("UPDATE admins SET email=LOWER(TRIM(email))").run();
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS admins_email_unique_lower ON admins(email COLLATE NOCASE)");
db.prepare("UPDATE admins SET role='admin' WHERE role NOT IN ('admin','owner')").run();
db.prepare("UPDATE admins SET role='admin' WHERE role='owner' AND email!=? COLLATE NOCASE").run(MAIN_ADMIN_EMAIL);
if (mainAdminCustomer) {
  const previousOwner = db.prepare("SELECT id,role FROM admins WHERE email=? COLLATE NOCASE").get(MAIN_ADMIN_EMAIL);
  db.prepare("UPDATE admins SET role='owner' WHERE email=? COLLATE NOCASE").run(MAIN_ADMIN_EMAIL);
  if (previousOwner && previousOwner.role !== "owner") {
    db.prepare("INSERT INTO admin_access_audit(actor_email,target_email,action,created_at) VALUES(?,?,?,?)")
      .run("system",MAIN_ADMIN_EMAIL,"owner_configured",new Date().toISOString());
  }
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    database.exec(`
      CREATE TABLE IF NOT EXISTS app_sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS app_sessions_expires_idx ON app_sessions(expires);
    `);
    this.getStatement = database.prepare("SELECT sess, expires FROM app_sessions WHERE sid=?");
    this.setStatement = database.prepare(`
      INSERT INTO app_sessions(sid,sess,expires) VALUES(?,?,?)
      ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expires=excluded.expires
    `);
    this.touchStatement = database.prepare("UPDATE app_sessions SET expires=? WHERE sid=?");
    this.destroyStatement = database.prepare("DELETE FROM app_sessions WHERE sid=?");
    this.expireStatement = database.prepare("DELETE FROM app_sessions WHERE expires<=?");
  }

  expiration(sessionData) {
    const cookie = sessionData.cookie || {};
    const expires = cookie.expires ? new Date(cookie.expires).getTime() : NaN;
    if (Number.isFinite(expires)) return expires;
    const maxAge = Number(cookie.maxAge);
    return Date.now() + (Number.isFinite(maxAge) && maxAge > 0 ? maxAge : 24 * 60 * 60 * 1000);
  }

  get(sid, callback) {
    try {
      const row = this.getStatement.get(sid);
      if (!row) return callback(null, null);
      if (row.expires <= Date.now()) {
        this.destroyStatement.run(sid);
        return callback(null, null);
      }
      callback(null, JSON.parse(row.sess));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sessionData, callback) {
    try {
      this.expireStatement.run(Date.now());
      this.setStatement.run(sid, JSON.stringify(sessionData), this.expiration(sessionData));
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid, sessionData, callback) {
    try {
      this.touchStatement.run(this.expiration(sessionData), sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.destroyStatement.run(sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }
}
const sessionStore = new SQLiteSessionStore(db);
app.use(session({
  name: "bs.sid", secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false, saveUninitialized: false,
  store: sessionStore,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use("/api", (req,res,next) => {
  res.set("Cache-Control","no-store");
  next();
});
app.get("/admin.html", (req,res) => {
  if(!req.session.adminId || !db.prepare("SELECT 1 FROM admins WHERE id=?").get(req.session.adminId)) return res.redirect(req.session.customerId?"/":"/admin");
  res.sendFile(path.join(__dirname,"public","admin.html"));
});
function sendBrandLogo(image,res) {
  res.set("Cache-Control","no-store");
  if (!image || image === "/brand-logo.png")
    return res.sendFile(path.join(__dirname,"public","brand-logo.png"),{headers:{"Cache-Control":"no-store"}});
  if (image.startsWith("/uploads/")) {
    const filename = image.slice("/uploads/".length);
    if (!filename || path.basename(filename) !== filename) return res.sendStatus(404);
    return res.sendFile(path.join(uploadsDir,filename),{headers:{"Cache-Control":"no-store"}});
  }
  res.redirect(302,image);
}
app.get("/brand-logo.png", (req,res) => sendBrandLogo("/brand-logo.png",res));
app.get("/brand-logo/:page", (req,res) => {
  if (!logoPages.some(([page]) => page === req.params.page)) return res.sendStatus(404);
  const logo = db.prepare("SELECT image FROM site_images WHERE key=?").get(`brand-logo-${req.params.page}`);
  sendBrandLogo(logo?.image,res);
});
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadsDir));

const isDateActive = (startDate, endDate) => {
  const today = new Date();
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (startDate && startDate.trim()) {
    const start = new Date(startDate + "T00:00:00");
    if (Number.isNaN(start.getTime()) || start > currentDay) return false;
  }
  if (endDate && endDate.trim()) {
    const end = new Date(endDate + "T23:59:59");
    if (Number.isNaN(end.getTime()) || end < currentDay) return false;
  }
  return true;
};
function getProductDiscountedPrice(product) {
  const originalPrice = Number(product.price);
  const explicitOfferPrice = Number(product.offer_price);
  if (Number.isFinite(explicitOfferPrice) && explicitOfferPrice > 0 && explicitOfferPrice < originalPrice) {
    return explicitOfferPrice;
  }
  const discountPercent = Number(product.discount_percent) || 0;
  return discountPercent > 0
    ? Math.round(originalPrice * (100 - discountPercent)) / 100
    : originalPrice;
}
function getProductSellingPrice(product) {
  return getProductDiscountedPrice(product);
}
const safeProduct = p => {
  const sellingPrice = getProductSellingPrice(p);
  const campaignDiscount = p.price > sellingPrice ? Math.round(((p.price - sellingPrice) / p.price) * 100) : 0;
  return {
    ...p,
    selling_price: sellingPrice,
    discountPercent: p.discount_percent > 0 && sellingPrice === getProductDiscountedPrice(p)
      ? p.discount_percent
      : campaignDiscount,
    featured: !!p.featured,
    active: !!p.active,
    out_of_stock: !!p.out_of_stock
  };
};
function requireAdmin(req,res,next) {
  const admin=req.session.adminId && db.prepare("SELECT id,email,role FROM admins WHERE id=?").get(req.session.adminId);
  if (!admin) {
    req.session.adminId=null;
    return res.status(401).json({error:"Your administrator access is no longer active. Please sign in again."});
  }
  const email=String(admin.email).toLowerCase();
  const registeredOwner=email===MAIN_ADMIN_EMAIL&&Boolean(db.prepare("SELECT 1 FROM customers WHERE email=? COLLATE NOCASE").get(MAIN_ADMIN_EMAIL));
  req.admin={...admin,email,isMainAdmin:admin.role==="owner"&&registeredOwner};
  next();
}
function requireMainAdmin(req,res,next) {
  if (!req.admin?.isMainAdmin) return res.status(403).json({error:"Only the designated Main Admin can perform this action."});
  next();
}
app.get("/api/site-images", (req,res) => {
  res.json(db.prepare("SELECT key,label,image,sort_order FROM site_images WHERE key NOT LIKE 'brand-logo-%' AND key!='brand-logo' ORDER BY sort_order,key").all());
});
app.get("/api/contact", (req,res) => {
  res.json(db.prepare("SELECT phone,email,address FROM contact_details WHERE id=1").get());
});
app.get("/api/reviews", (req,res) => {
  res.json(db.prepare(`
    SELECT customer_name AS name,rating,description,created_at
    FROM reviews WHERE status='approved' ORDER BY created_at DESC,id DESC
  `).all());
});
app.post("/api/reviews", requireCustomer, (req,res) => {
  const description=String((req.body||{}).description||"").trim();
  const rating=Number((req.body||{}).rating);
  if (!Number.isInteger(rating)||rating<1||rating>5) return res.status(400).json({error:"Choose a rating from 1 to 5 stars."});
  if (!description||description.length>2000) return res.status(400).json({error:"Write a review of up to 2,000 characters."});
  const customer=db.prepare("SELECT id,name,email FROM customers WHERE id=?").get(req.session.customerId);
  if (!customer) return res.status(401).json({error:"Please sign in to submit a review."});
  const result=db.prepare(`
    INSERT INTO reviews(customer_id,customer_name,customer_email,rating,description,status)
    VALUES(?,?,?,?,?,'pending')
  `).run(customer.id,customer.name,customer.email,rating,description);
  res.status(201).json({message:"Thank you. Your review has been submitted for approval.",id:Number(result.lastInsertRowid)});
});
app.get("/api/admin/site-images", requireAdmin, (req,res) => {
  res.json(db.prepare("SELECT key,label,image,default_image,previous_image,sort_order FROM site_images WHERE key!='brand-logo' ORDER BY CASE WHEN key LIKE 'brand-logo-%' THEN 0 ELSE 1 END,sort_order,key").all());
});
app.get("/api/admin/offer-banner", requireAdmin, (req,res) => {
  const banner = db.prepare("SELECT image,active,updated_at FROM homepage_offer_banner WHERE id=1").get();
  res.json({...banner,active:Boolean(banner.active)});
});
app.put("/api/admin/offer-banner", requireAdmin, (req,res) => {
  const image = String(req.body?.image || "").trim();
  const active = req.body?.active;
  if (typeof active !== "boolean") return res.status(400).json({error:"Choose whether the offer banner should be visible."});
  if (image.length > 2000 || (image && !(/^(https?:\/\/|\/(?!\/))/.test(image))))
    return res.status(400).json({error:"Use an uploaded image, HTTPS/HTTP image URL, or a site-relative image path."});
  if (active && !image) return res.status(400).json({error:"Upload or choose an offer image before publishing the banner."});
  const updatedAt = serverTimestamp();
  db.prepare("UPDATE homepage_offer_banner SET image=?,active=?,updated_at=? WHERE id=1")
    .run(image,active ? 1 : 0,updatedAt);
  res.json({message:image ? (active ? "Offer banner published." : "Offer banner saved and hidden.") : "Offer banner removed.",image,active,updated_at:updatedAt});
});
app.get("/api/admin/offer-banners", requireAdmin, (req,res) => {
  const home = db.prepare("SELECT image,active,updated_at FROM homepage_offer_banner WHERE id=1").get();
  const pages = db.prepare("SELECT placement,image,active,updated_at FROM page_offer_banners").all();
  const banners = Object.fromEntries(pages.map(({placement,...banner}) => [placement,{...banner,active:Boolean(banner.active)}]));
  banners.home = {...home,active:Boolean(home.active)};
  res.json(banners);
});
app.put("/api/admin/offer-banners/:placement", requireAdmin, (req,res) => {
  const placement = String(req.params.placement || "");
  if (!["home","new-collection","offers"].includes(placement)) return res.status(404).json({error:"Offer banner placement not found."});
  const image = String(req.body?.image || "").trim();
  const active = req.body?.active;
  if (typeof active !== "boolean") return res.status(400).json({error:"Choose whether this banner should be displayed."});
  if (image.length > 2000 || (image && !(/^(https?:\/\/|\/(?!\/))/.test(image))))
    return res.status(400).json({error:"Choose a valid uploaded image or image URL."});
  if (active && !image) return res.status(400).json({error:"Upload or choose an image before publishing this banner."});
  const updatedAt = serverTimestamp();
  if (placement === "home") {
    db.prepare("UPDATE homepage_offer_banner SET image=?,active=?,updated_at=? WHERE id=1")
      .run(image,active ? 1 : 0,updatedAt);
  } else {
    db.prepare("UPDATE page_offer_banners SET image=?,active=?,updated_at=? WHERE placement=?")
      .run(image,active ? 1 : 0,updatedAt,placement);
  }
  res.json({
    message:image ? (active ? "Banner published." : "Banner saved and hidden.") : "Banner removed.",
    placement,image,active,updated_at:updatedAt
  });
});
app.get("/api/admin/site-images/library", requireAdmin, (req,res) => {
  try {
    const imageExtensions = new Set([".jpg",".jpeg",".png",".webp",".gif"]);
    const images = fs.readdirSync(uploadsDir,{withFileTypes:true})
      .filter(entry => entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase()))
      .map(entry => {
        const stat = fs.statSync(path.join(uploadsDir,entry.name));
        return {name:entry.name,image:`/uploads/${encodeURIComponent(entry.name)}`,updated_at:stat.mtime.toISOString()};
      })
      .sort((left,right) => right.updated_at.localeCompare(left.updated_at));
    res.json(images);
  } catch (error) {
    console.error("Website image library could not be read:",error);
    res.status(500).json({error:"Could not load the website image library."});
  }
});
app.get("/api/admin/site-image-config", requireAdmin, (req,res) => {
  res.json({
    googleClientId:process.env.GOOGLE_CLIENT_ID || "",
    googleDriveApiKey:process.env.GOOGLE_DRIVE_API_KEY || "",
    googleDriveAppId:process.env.GOOGLE_DRIVE_APP_ID || ""
  });
});
app.get("/api/site-content", (req,res) => {
  res.json(db.prepare("SELECT key,label,eyebrow,heading,heading_accent,description,button_text,button_link,active,sort_order FROM site_sections ORDER BY sort_order,key").all().map(section => ({...section,active:!!section.active})));
});
app.get("/api/categories", (req,res) => {
  res.json(db.prepare(`
    SELECT c.id,c.name,c.sort_order,c.image,c.description,c.active,c.created_at,c.updated_at,
           COUNT(p.id) AS product_count,
           SUM(CASE WHEN p.active=1 THEN 1 ELSE 0 END) AS active_product_count
    FROM categories c
    LEFT JOIN products p ON p.category=c.name
    WHERE c.active=1
    GROUP BY c.id
    ORDER BY c.sort_order,c.name COLLATE NOCASE
  `).all());
});
app.get("/api/admin/categories", requireAdmin, (req,res) => {
  res.json(db.prepare(`
    SELECT c.id,c.name,c.sort_order,c.image,c.description,c.active,c.created_at,c.updated_at,
           COUNT(p.id) AS product_count,
           SUM(CASE WHEN p.active=1 THEN 1 ELSE 0 END) AS active_product_count
    FROM categories c
    LEFT JOIN products p ON p.category=c.name
    GROUP BY c.id
    ORDER BY c.sort_order,c.name COLLATE NOCASE
  `).all().map(category => ({...category,active:Boolean(category.active)})));
});
app.put("/api/admin/site-content/:key", requireAdmin, (req,res) => {
  const key = String(req.params.key || "");
  const data = req.body || {};
  const existing = db.prepare("SELECT key FROM site_sections WHERE key=?").get(key);
  if (!existing) return res.status(404).json({error:"Homepage section not found."});
  const eyebrow = String(data.eyebrow || "").trim();
  const heading = String(data.heading || "").trim();
  const headingAccent = String(data.heading_accent || "").trim();
  const description = String(data.description || "").trim();
  const buttonText = String(data.button_text || "").trim();
  const buttonLink = String(data.button_link || "").trim();
  const sortOrder = Number(data.sort_order);
  if (eyebrow.length > 80 || heading.length > 240 || headingAccent.length > 120 || description.length > 1000 || buttonText.length > 100 || buttonLink.length > 500)
    return res.status(400).json({error:"Homepage content exceeds the allowed length."});
  if (buttonLink && !/^(\/(?!\/)|#[A-Za-z0-9_-]+|https:\/\/)/i.test(buttonLink))
    return res.status(400).json({error:"Use a site path, page anchor, or HTTPS link for the button."});
  if (typeof data.active !== "boolean") return res.status(400).json({error:"Choose whether the homepage section is enabled."});
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000)
    return res.status(400).json({error:"Section order must be a whole number from 0 to 1000."});
  db.prepare(`
    UPDATE site_sections SET eyebrow=?,heading=?,heading_accent=?,description=?,button_text=?,button_link=?,active=?,sort_order=?
    WHERE key=?
  `).run(eyebrow,heading,headingAccent,description,buttonText,buttonLink,data.active ? 1 : 0,sortOrder,key);
  res.json({message:"Homepage section saved."});
});
app.post("/api/admin/site-images/:key/restore-previous", requireAdmin, (req,res) => {
  const key = String(req.params.key || "");
  const image = db.prepare("SELECT image,previous_image FROM site_images WHERE key=?").get(key);
  if (!image) return res.status(404).json({error:"Website image not found."});
  if (!image.previous_image) return res.status(409).json({error:"There is no previous image to restore."});
  db.prepare("UPDATE site_images SET image=?,previous_image=?,updated_at=? WHERE key=?")
    .run(image.previous_image,image.image,serverTimestamp(),key);
  res.json({message:"Previous image restored."});
});
app.post("/api/admin/site-images/:key/restore-default", requireAdmin, (req,res) => {
  const key = String(req.params.key || "");
  const image = db.prepare("SELECT image,default_image FROM site_images WHERE key=?").get(key);
  if (!image) return res.status(404).json({error:"Website image not found."});
  if (!image.default_image) return res.status(409).json({error:"There is no default image for this section."});
  db.prepare("UPDATE site_images SET image=?,previous_image=?,updated_at=? WHERE key=?")
    .run(image.default_image,image.image,serverTimestamp(),key);
  res.json({message:"Default image restored."});
});
function readCategoryPayload(data = {}) {
  const name = normalizeCategoryName(data.name);
  const description = String(data.description || "").trim();
  const image = String(data.image || "").trim();
  if (!name || name.length > 80) return {error:"Enter a category name of up to 80 characters."};
  if (description.length > 1000) return {error:"Category description must be 1,000 characters or fewer."};
  if (image.length > 2000 || (image && !(/^(https?:\/\/|\/(?!\/))/.test(image)))) return {error:"Enter a valid HTTPS, HTTP, or site-relative category image URL."};
  if (data.active !== undefined && typeof data.active !== "boolean") return {error:"Choose whether the category should be active."};
  return {name,description,image,active:data.active === false ? 0 : 1};
}
function categoryNameExists(name, excludedId = 0) {
  const normalizedName = name.toLowerCase();
  return db.prepare("SELECT id,name FROM categories WHERE id!=?").all(excludedId)
    .some(category => normalizeCategoryName(category.name).toLowerCase() === normalizedName);
}
app.post("/api/admin/categories", requireAdmin, (req,res) => {
  const category = readCategoryPayload(req.body);
  if (category.error) return res.status(400).json({error:category.error});
  const {name,description,image,active} = category;
  if (categoryNameExists(name)) return res.status(409).json({error:"That category already exists."});
  const sortOrder = db.prepare("SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM categories").get().next;
  const now = serverTimestamp();
  const info = db.prepare("INSERT INTO categories(name,sort_order,image,description,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run(name,sortOrder,image,description,active,now,now);
  res.status(201).json({id:info.lastInsertRowid,name,sort_order:sortOrder,image,description,active:Boolean(active),created_at:now,updated_at:now,product_count:0});
});
app.put("/api/admin/categories/:id", requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({error:"Invalid category."});
  const payload = readCategoryPayload(req.body);
  if (payload.error) return res.status(400).json({error:payload.error});
  const existing = db.prepare("SELECT id,name FROM categories WHERE id=?").get(id);
  if (!existing) return res.status(404).json({error:"Category not found."});
  if (categoryNameExists(payload.name,id)) return res.status(409).json({error:"That category already exists."});
  const now = serverTimestamp();
  db.transaction(() => {
    db.prepare("UPDATE categories SET name=?,image=?,description=?,active=?,updated_at=? WHERE id=?")
      .run(payload.name,payload.image,payload.description,payload.active,now,id);
    db.prepare("UPDATE products SET category=? WHERE category=?").run(payload.name,existing.name);
  })();
  res.json({message:"Category saved.",updated_at:now});
});
app.patch("/api/admin/categories/:id/status", requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({error:"Invalid category."});
  if (typeof req.body.active !== "boolean") return res.status(400).json({error:"Choose whether the category should be active."});
  const now = serverTimestamp();
  const result = db.prepare("UPDATE categories SET active=?,updated_at=? WHERE id=?").run(req.body.active ? 1 : 0,now,id);
  if (!result.changes) return res.status(404).json({error:"Category not found."});
  res.json({message:req.body.active ? "Category activated." : "Category deactivated.",updated_at:now});
});
app.delete("/api/admin/categories/:id", requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({error:"Invalid category."});
  const category = db.prepare("SELECT id,name FROM categories WHERE id=?").get(id);
  if (!category) return res.status(404).json({error:"Category not found."});
  const productCount = db.prepare("SELECT COUNT(*) AS count FROM products WHERE category=?").get(category.name).count;
  const targetId = req.body?.reassign_to === undefined ? null : Number(req.body.reassign_to);
  if (productCount && (!Number.isInteger(targetId) || targetId <= 0))
    return res.status(409).json({error:`${productCount} product${productCount === 1 ? "" : "s"} use this category. Select an active category to reassign them before deleting it.`,product_count:productCount});
  const target = targetId === null ? null : db.prepare("SELECT id,name,active FROM categories WHERE id=? AND id!=?").get(targetId,id);
  if (targetId !== null && !target) return res.status(400).json({error:"Choose another valid category for reassignment."});
  if (productCount && !target.active) return res.status(400).json({error:"Products can only be reassigned to an active category."});
  db.transaction(() => {
    if (productCount) db.prepare("UPDATE products SET category=? WHERE category=?").run(target.name,category.name);
    db.prepare("DELETE FROM categories WHERE id=?").run(id);
  })();
  res.json({message:productCount ? `${productCount} product${productCount === 1 ? "" : "s"} reassigned and category removed.` : "Category removed.",product_count:productCount});
});
app.put("/api/admin/site-images/:key", requireAdmin, (req,res) => {
  const key=String(req.params.key||"");
  const image=String(req.body.image||"").trim();
  const known=db.prepare("SELECT key FROM site_images WHERE key=?").get(key);
  if(!known) return res.status(404).json({error:"Site image not found."});
  if(image.length>2000 || (image && !(/^(https?:\/\/|\/(?!\/))/.test(image)))) return res.status(400).json({error:"Enter a valid HTTPS, HTTP, site-relative image path, or leave it empty to remove the image."});
  const sortOrder = req.body.sort_order === undefined ? null : Number(req.body.sort_order);
  if (sortOrder !== null && (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000)) return res.status(400).json({error:"Image order must be a whole number from 0 to 1000."});
  db.prepare(`
    UPDATE site_images SET
      previous_image=CASE WHEN image!=? THEN image ELSE previous_image END,
      image=?,sort_order=COALESCE(?,sort_order),updated_at=?
    WHERE key=?
  `).run(image,image,sortOrder,serverTimestamp(),key);
  res.json(db.prepare("SELECT key,label,image,default_image,previous_image,sort_order FROM site_images WHERE key=?").get(key));
});
app.get("/api/homepage", (req,res) => {
  res.set("Cache-Control","no-store");
  const collection = db.prepare(`
    SELECT cp.id, cp.product_id, cp.sort_order, p.name, p.category, p.description, p.image, p.price, p.offer_price, p.discount_percent, p.stock, p.featured, p.out_of_stock, p.active
    FROM collection_products cp
    JOIN products p ON p.id = cp.product_id
    WHERE cp.active = 1 AND p.active = 1
      AND EXISTS (SELECT 1 FROM categories c WHERE c.name=p.category AND c.active=1)
    ORDER BY cp.sort_order ASC, cp.id ASC
  `).all().map(item => safeProduct({...item,id:item.product_id}));
  const banners = db.prepare(`
    SELECT * FROM offer_banners
    WHERE active = 1
    ORDER BY sort_order ASC, id ASC
  `).all().filter(b => isDateActive(b.start_date, b.end_date));
  const specialOffers = db.prepare(`
    SELECT sop.id, sop.product_id, sop.offer_label, sop.start_date, sop.end_date, sop.active, sop.sort_order, sop.featured,
           p.name, p.category, p.description, p.image, p.price, p.offer_price, p.discount_percent, p.stock, p.out_of_stock, p.featured AS product_featured
    FROM special_offer_products sop
    JOIN products p ON p.id = sop.product_id
    WHERE sop.active = 1 AND p.active = 1
      AND EXISTS (SELECT 1 FROM categories c WHERE c.name=p.category AND c.active=1)
    ORDER BY sop.sort_order ASC, sop.id ASC
  `).all().filter(item => isDateActive(item.start_date, item.end_date)).map(item => {
    const product = safeProduct({...item,id:item.product_id});
    return {
      ...product,
      product_featured: !!item.product_featured,
      featured: !!item.featured
    };
  });
  const offerBanner = db.prepare("SELECT image,active,updated_at FROM homepage_offer_banner WHERE id=1").get();
  const pageBanners = Object.fromEntries(db.prepare("SELECT placement,image,active,updated_at FROM page_offer_banners").all()
    .map(({placement,image,active,updated_at}) => [placement,{image,active:Boolean(active),updated_at}]));
  res.json({
    collection,banners,specialOffers,
    offerBanner:{...offerBanner,active:Boolean(offerBanner.active)},
    offerBanners:{
      home:{...offerBanner,active:Boolean(offerBanner.active)},
      newCollection:pageBanners["new-collection"],
      offers:pageBanners.offers
    }
  });
});
app.get("/api/products", (req,res) => {
  const homepageOnly = req.query.homepage === "1";
  const rows = db.prepare(`
    SELECT p.* FROM products p
    JOIN categories c ON c.name=p.category AND c.active=1
    ${homepageOnly ? "JOIN homepage_shop_products hs ON hs.product_id=p.id" : ""}
    WHERE p.active=1
    ORDER BY ${homepageOnly ? "hs.sort_order ASC,p.id ASC" : "p.featured DESC,p.created_at DESC"}
    ${homepageOnly ? "LIMIT 8" : ""}
  `).all();
  res.json(rows.map(safeProduct));
});
app.get("/api/products/:id", (req,res) => {
  const p = db.prepare(`
    SELECT p.* FROM products p
    JOIN categories c ON c.name=p.category AND c.active=1
    WHERE p.id=? AND p.active=1
  `).get(Number(req.params.id));
  if (!p) return res.status(404).json({error:"Product not found."});
  res.json(safeProduct(p));
});
app.post("/api/orders", requireCustomer, (req,res) => {
  const { customer, items, paymentMethod } = req.body || {};
  if (!customer || !customer.name || !customer.email || !customer.phone || !customer.address || !Array.isArray(items) || !items.length)
    return res.status(400).json({error:"Please complete all delivery details and add at least one item."});
  if (items.length > 50) return res.status(400).json({error:"Too many items in one order."});
  const cleanItems = [];
  let total = 0;
  const requestedQuantities = new Map();
  const productsById = new Map();
  const get = db.prepare("SELECT id,name,price,offer_price,discount_percent,stock,active,out_of_stock FROM products WHERE id=?");
  const createOrder = db.prepare("INSERT INTO orders(customer_name,email,phone,address,items_json,total,payment_method,customer_id,created_at,stock_deducted) VALUES(?,?,?,?,?,?,?,?,?,0)");
  try {
    const result = db.transaction(() => {
      for (const item of items) {
        const id = Number(item.id), qty = Math.floor(Number(item.quantity));
        if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error("Please check the item quantities.");
        const p = get.get(id);
        if (!p || !p.active || !db.prepare("SELECT 1 FROM categories c JOIN products p ON p.category=c.name WHERE p.id=? AND c.active=1").get(id))
          throw new Error("A product in your cart is no longer available.");
        if (p.out_of_stock || p.stock < 1) throw new Error(`${p.name} is out of stock.`);
        requestedQuantities.set(id,(requestedQuantities.get(id) || 0) + qty);
        productsById.set(id,p);
        const sellingPrice = getProductSellingPrice(p);
        cleanItems.push({
          id:p.id,
          name:p.name,
          price:sellingPrice,
          unit_price:sellingPrice,
          original_price:p.price,
          discount_percent:p.discount_percent || 0,
          quantity:qty
        });
        total += sellingPrice * qty;
      }
      for (const [productId,quantity] of requestedQuantities) {
        const product = productsById.get(productId);
        if (product.stock < quantity) throw new Error(`${product.name} has only ${product.stock} left in stock.`);
      }
      total = Math.round(total * 100) / 100;
      const method = paymentMethod === "Cash on Delivery" ? "Cash on Delivery" : "Pay on delivery";
      const createdAt = serverTimestamp();
      const info = createOrder.run(
        String(customer.name).trim().slice(0,100), String(customer.email).trim().slice(0,160),
        String(customer.phone).trim().slice(0,30), String(customer.address).trim().slice(0,600),
        JSON.stringify(cleanItems), total, method, req.session.customerId || null, createdAt
      );
      const orderId = Number(info.lastInsertRowid);
      db.prepare("INSERT INTO order_status_updates(order_id,status,note,changed_by,created_at) VALUES(?,'New','Order placed and awaiting confirmation.','system',?)")
        .run(orderId,createdAt);
      return orderId;
    })();
    res.status(201).json({message:"Order placed successfully.", orderId:result, total});
  } catch (e) { res.status(400).json({error:e.message || "Could not place order."}); }
});

const publicCustomer = c => ({
  id:c.id,name:c.name,username:c.username||"",email:c.email,phone:c.phone||"",address:c.address||"",
  created_at:c.created_at,updated_at:c.updated_at||c.created_at,
  hasAdminAccess:Boolean(db.prepare("SELECT 1 FROM admins WHERE email=? COLLATE NOCASE").get(c.email))
});
function requireCustomer(req,res,next) {
  if (!req.session.customerId) return res.status(401).json({error:"Please sign in to view your account."});
  next();
}
const passwordResetSecret=String(process.env.SESSION_SECRET||"development-only-change-this-secret");
const hashPasswordResetValue=value=>crypto.createHmac("sha256",passwordResetSecret).update(value).digest("hex");
const passwordResetCookieName="bs.password-reset";
const passwordResetCookieOptions={
  httpOnly:true,
  sameSite:"strict",
  secure:process.env.NODE_ENV==="production",
  path:"/",
  maxAge:10*365*24*60*60*1000
};
const passwordResetCookieClearOptions={
  httpOnly:true,
  sameSite:"strict",
  secure:process.env.NODE_ENV==="production",
  path:"/"
};
function passwordResetBrowserToken(req) {
  const cookie=String(req.headers.cookie||"").split(";").map(part=>part.trim())
    .find(part=>part.startsWith(`${passwordResetCookieName}=`));
  const token=cookie ? cookie.slice(passwordResetCookieName.length+1) : "";
  return /^[a-f0-9]{64}$/i.test(token) ? token : "";
}
function passwordResetRequestForBrowser(req) {
  const browserToken=passwordResetBrowserToken(req);
  if (!browserToken) return null;
  const request=db.prepare(`SELECT id,status,customer_id FROM password_reset_requests
    WHERE reset_token_hash=? ORDER BY id DESC LIMIT 1`)
    .get(hashPasswordResetValue(browserToken)) || null;
  return request && request.customer_id ? request : null;
}
function invalidateCustomerSessions(customerId,email,callback) {
  const admin=db.prepare("SELECT id FROM admins WHERE email=? COLLATE NOCASE").get(email);
  sessionStore.all((error,sessions)=>{
    if(error) return callback(error);
    const sessionIds=Object.entries(sessions||{})
      .filter(([,sessionData])=>Number(sessionData.customerId)===customerId
        || (admin && Number(sessionData.adminId)===Number(admin.id)))
      .map(([sessionId])=>sessionId);
    let index=0;
    const destroyNext=destroyError=>{
      if(destroyError) return callback(destroyError);
      if(index>=sessionIds.length) return callback(null);
      sessionStore.destroy(sessionIds[index++],destroyNext);
    };
    destroyNext(null);
  });
}
const serverTimestamp = () => new Date().toISOString();
const formatDeliveryAddress = address => [address.house,address.street,address.landmark,address.city,address.state,address.pin_code]
  .map(value => String(value || "").trim()).filter(Boolean).join(", ");
function normalizeAddress(body) {
  const fields = ["recipient_name","phone","house","street","city","state","pin_code","country","landmark","label"];
  const address = Object.fromEntries(fields.map(field => [field, String(body[field] || "").trim()]));
  if (!address.country) address.country = "India";
  for (const field of ["recipient_name","phone","house","street","city","state","pin_code"]) {
    if (!address[field]) return {error:`${field.replaceAll("_"," ")} is required.`};
  }
  const phoneDigits = address.phone.replace(/\D/g,"");
  const localPhone = phoneDigits.length === 12 && phoneDigits.startsWith("91") ? phoneDigits.slice(2) : phoneDigits;
  if (!/^[6-9]\d{9}$/.test(localPhone)) return {error:"Enter a valid 10-digit Indian phone number."};
  if (!/^[1-9]\d{5}$/.test(address.pin_code)) return {error:"Enter a valid 6-digit Indian PIN code."};
  if (!["Home","Work","Other"].includes(address.label)) return {error:"Choose Home, Work, or Other as the address label."};
  address.phone = localPhone;
  for (const [field, max] of [["recipient_name",100],["house",160],["street",600],["city",100],["state",100],["country",100],["landmark",160]]) {
    if (address[field].length > max) return {error:`${field.replaceAll("_"," ")} must be ${max} characters or fewer.`};
  }
  if (formatDeliveryAddress(address).length > 600) return {error:"Address must be 600 characters or fewer."};
  return {address};
}
app.post("/api/auth/register", (req,res) => {
  const resetRequest=passwordResetRequestForBrowser(req);
  if (resetRequest && ["PENDING","APPROVED"].includes(resetRequest.status))
    return res.status(409).json({error:"Complete your administrator-approved password reset before creating or signing in to an account."});
  const body=req.body||{};
  const name=String(body.name||"").trim(), username=String(body.username||"").trim().toLowerCase();
  const email=String(body.email||"").trim().toLowerCase(), password=String(body.password||"");
  const confirmPassword=String(body.confirmPassword||""), phone=String(body.phone||"").trim();
  const address=String(body.address||"").trim();
  if (!name || name.length>100) return res.status(400).json({error:"Enter your full name (up to 100 characters)."});
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.]{2,29}$/.test(username)) return res.status(400).json({error:"Username must be 3–30 characters and use letters, numbers, dots, or underscores."});
  if (!/^[a-z0-9._%+-]+@gmail\.com$/i.test(email)) return res.status(400).json({error:"Enter a valid Gmail address ending in @gmail.com."});
  if (password.length<6||password.length>12) return res.status(400).json({error:"Choose a password with 6–12 characters."});
  if (password!==confirmPassword) return res.status(400).json({error:"Passwords do not match."});
  const phoneDigits=phone.replace(/\D/g,"");
  const normalizedPhone=phoneDigits.length===12 && phoneDigits.startsWith("91") ? phoneDigits.slice(2) : phoneDigits;
  if (!/^[6-9]\d{9}$/.test(normalizedPhone)) return res.status(400).json({error:"Enter a valid 10-digit Indian contact number."});
  if (!address || address.length>600) return res.status(400).json({error:"Enter your address (up to 600 characters)."});
  try {
    const now=serverTimestamp();
    const created=db.transaction(() => {
      const info=db.prepare("INSERT INTO customers(name,email,username,password_hash,phone,address,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(name,email,username,bcrypt.hashSync(password,12),normalizedPhone.replace(/^\+?91/,""),address,now,now);
      db.prepare(`INSERT INTO customer_addresses(customer_id,recipient_name,phone,street,country,label,is_default,created_at,updated_at)
        VALUES(?,?,?,?,?,'Home',1,?,?)`).run(info.lastInsertRowid,name,normalizedPhone.replace(/^\+?91/,""),address,"India",now,now);
      return info;
    })();
    const info=created;
    const customer=db.prepare("SELECT * FROM customers WHERE id=?").get(info.lastInsertRowid);
    req.session.regenerate(err=>{ if(err)return res.status(500).json({error:"Could not start your session."}); req.session.customerId=Number(info.lastInsertRowid); res.status(201).json({customer:publicCustomer(customer)}); });
  } catch(e) {
    if(String(e.message).includes("UNIQUE")) {
      const emailExists=db.prepare("SELECT 1 FROM customers WHERE email=? COLLATE NOCASE").get(email);
      return res.status(409).json({error:emailExists?"An account with this Gmail address already exists. Please sign in.":"That username is already taken. Choose another username."});
    }
    console.error("Customer registration failed:",e);
    res.status(500).json({error:"Could not create your account."});
  }
});
app.post("/api/auth/login", (req,res) => {
  const resetRequest=passwordResetRequestForBrowser(req);
  if (resetRequest && ["PENDING","APPROVED"].includes(resetRequest.status))
    return res.status(409).json({error:"Complete your administrator-approved password reset before signing in."});
  const body=req.body||{};
  const identifier=String(body.identifier||"").trim().toLowerCase(), password=String(body.password||"");
  if(!identifier || !password) return res.status(400).json({error:"Enter your username or Gmail address and password."});
  const c=db.prepare("SELECT * FROM customers WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE").get(identifier,identifier);
  if(!c || !c.password_hash || !bcrypt.compareSync(password,c.password_hash)) return res.status(401).json({error:"Username or password is incorrect. If you used your Gmail address, check that it is the one registered to your account."});
  req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Could not start your session."}); req.session.customerId=c.id; res.json({customer:publicCustomer(c)});});
});
app.get("/api/auth/me", (req,res) => { const c=req.session.customerId && db.prepare("SELECT * FROM customers WHERE id=?").get(req.session.customerId); res.json({authenticated:!!c,customer:c?publicCustomer(c):null}); });
app.get("/api/auth/reviews", requireCustomer, (req,res) => {
  const reviews=db.prepare(`
    SELECT id,rating,description,status,created_at
    FROM reviews WHERE customer_id=? ORDER BY created_at DESC,id DESC
  `).all(req.session.customerId);
  res.json({reviews});
});
app.put("/api/auth/password", (req,res) => {
  const customerId=Number(req.session.customerId);
  if (!Number.isInteger(customerId)||customerId<=0)
    return res.status(401).json({error:"Please sign in before changing your password. A signed-in account session is required."});
  const body=req.body||{};
  const password=String(body.password||"");
  const confirmPassword=String(body.confirmPassword||"");
  if (password.length<6||password.length>12)
    return res.status(400).json({error:"Use 6–12 characters."});
  if (password!==confirmPassword) return res.status(400).json({error:"Passwords do not match."});
  const customer=db.prepare("SELECT id,email FROM customers WHERE id=?").get(customerId);
  if (!customer) return res.status(401).json({error:"Please sign in before changing your password."});
  try {
    const passwordHash=bcrypt.hashSync(password,12);
    db.transaction(()=>{
      db.prepare("UPDATE customers SET password_hash=?,updated_at=? WHERE id=?")
        .run(passwordHash,serverTimestamp(),customer.id);
      db.prepare("UPDATE admins SET password_hash=? WHERE email=? COLLATE NOCASE")
        .run(passwordHash,customer.email);
    })();
  } catch(error) {
    console.error("Authenticated password update failed:",error);
    return res.status(500).json({error:"Could not update your password. Please try again."});
  }
  req.session.destroy(error=>{
    if (error) {
      console.error("Session could not be cleared after password update:",error);
      return res.status(500).json({error:"Your password was updated, but your session could not be cleared. Please sign out and log in again."});
    }
    res.clearCookie("bs.sid",{path:"/",sameSite:"lax",secure:process.env.NODE_ENV==="production"});
    res.json({message:"Password updated successfully. Please log in."});
  });
});
app.post("/api/auth/password-reset/request", (req,res) => {
  const email=String((req.body||{}).email||"").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@gmail\.com$/i.test(email)||email.length>254)
    return res.status(400).json({error:"Enter a valid Gmail address."});
  const now=Date.now();
  const requestIpHash=hashPasswordResetValue(String(req.ip||"unknown").slice(0,100));
  db.prepare("DELETE FROM password_reset_attempts WHERE attempted_at<?").run(now-24*60*60*1000);
  const recentIp=db.prepare("SELECT COUNT(*) AS count FROM password_reset_attempts WHERE request_ip_hash=? AND attempted_at>?")
    .get(requestIpHash,now-60*60*1000);
  if (recentIp.count>=10) {
    return res.status(429).json({error:"Too many password-reset requests. Please wait before trying again."});
  }
  db.prepare("INSERT INTO password_reset_attempts(request_ip_hash,attempted_at) VALUES(?,?)")
    .run(requestIpHash,now);
  const customer=db.prepare("SELECT id FROM customers WHERE email=? COLLATE NOCASE").get(email);
  const genericMessage="Your password reset request has been submitted. You can return here after admin approval.";
  if (!customer)
    return res.json({status:"PENDING",message:genericMessage});
  const existingBrowserRequest=passwordResetRequestForBrowser(req);
  if(existingBrowserRequest && ["PENDING","APPROVED"].includes(existingBrowserRequest.status)
    && existingBrowserRequest.customer_id!==customer.id)
    return res.json({status:"PENDING",message:genericMessage});
  const createNewRequest=Boolean((req.body||{}).newRequest);
  const browserToken=passwordResetBrowserToken(req);
  const tokenHash=browserToken ? hashPasswordResetValue(browserToken) : "";
  const latest=db.prepare(`SELECT id,status,reset_token_hash FROM password_reset_requests
    WHERE customer_id=? ORDER BY id DESC LIMIT 1`).get(customer.id);
  if (!createNewRequest && latest && tokenHash && latest.reset_token_hash===tokenHash
    && ["PENDING","APPROVED","REJECTED"].includes(latest.status)) {
    res.cookie(passwordResetCookieName,browserToken,passwordResetCookieOptions);
    const messages={
      PENDING:"Your request is awaiting admin approval.",
      APPROVED:"Your request was approved. You can now set a new password.",
      REJECTED:"Your password reset request was rejected. You may submit a new request."
    };
    return res.json({status:latest.status,message:messages[latest.status]});
  }
  const newBrowserToken=crypto.randomBytes(32).toString("hex");
  const newTokenHash=hashPasswordResetValue(newBrowserToken);
  const requestId=db.transaction(()=>{
    db.prepare(`UPDATE password_reset_requests
      SET status='CANCELLED',code_hash='',reset_token_expires_at=NULL
      WHERE customer_id=? AND status IN ('PENDING','APPROVED')`).run(customer.id);
    const info=db.prepare(`INSERT INTO password_reset_requests(customer_id,request_ip_hash,status,requested_at,reset_token_hash,reset_token_expires_at)
      VALUES(?,?,'PENDING',?,?,NULL)`)
      .run(customer.id,requestIpHash,now,newTokenHash);
    return Number(info.lastInsertRowid);
  })();
  if(!requestId) return res.status(500).json({error:"Could not save your password reset request."});
  res.cookie(passwordResetCookieName,newBrowserToken,passwordResetCookieOptions);
  res.json({status:"PENDING",message:genericMessage});
});
app.get("/api/auth/password-reset/status", (req,res) => {
  const email=String(req.query.email||"").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@gmail\.com$/i.test(email)||email.length>254)
    return res.status(400).json({error:"Enter a valid Gmail address."});
  const customer=db.prepare("SELECT id FROM customers WHERE email=? COLLATE NOCASE").get(email);
  const browserToken=passwordResetBrowserToken(req);
  if(!customer||!browserToken) return res.json({status:"NONE"});
  const request=db.prepare(`SELECT id,status,reset_token_hash FROM password_reset_requests
    WHERE customer_id=? ORDER BY id DESC LIMIT 1`).get(customer.id);
  if(!request||request.reset_token_hash!==hashPasswordResetValue(browserToken))
    return res.json({status:"NONE"});
  if(!["PENDING","APPROVED","REJECTED","USED"].includes(request.status))
    return res.json({status:"NONE"});
  res.json({status:request.status});
});
app.post("/api/auth/password-reset/complete", (req,res) => {
  const body=req.body||{};
  const email=String(body.email||"").trim().toLowerCase();
  const password=String(body.password||"");
  const confirmPassword=String(body.confirmPassword||"");
  if (!/^[a-z0-9._%+-]+@gmail\.com$/i.test(email)||email.length>254)
    return res.status(400).json({error:"Enter a valid Gmail address."});
  if (password.length<6||password.length>12)
    return res.status(400).json({error:"Use 6–12 characters."});
  if (password!==confirmPassword) return res.status(400).json({error:"Passwords do not match."});
  const browserToken=passwordResetBrowserToken(req);
  if (!browserToken)
    return res.status(403).json({error:"Your administrator approval is not active for this browser. Submit a new password-reset request."});
  const tokenHash=hashPasswordResetValue(browserToken);
  try {
    const updated=db.transaction(()=>{
      const customer=db.prepare("SELECT id,email FROM customers WHERE email=? COLLATE NOCASE").get(email);
      if(!customer) return null;
      const request=db.prepare(`SELECT id,customer_id FROM password_reset_requests
        WHERE customer_id=? AND status='APPROVED' AND reset_token_hash=? AND used=0
        ORDER BY id DESC LIMIT 1`).get(customer.id,tokenHash);
      if (!request) return false;
      const passwordHash=bcrypt.hashSync(password,12);
      db.prepare("UPDATE customers SET password_hash=?,updated_at=? WHERE id=?")
        .run(passwordHash,serverTimestamp(),request.customer_id);
      db.prepare("UPDATE admins SET password_hash=? WHERE email=? COLLATE NOCASE")
        .run(passwordHash,customer.email);
      db.prepare(`UPDATE password_reset_requests
        SET status='CANCELLED',code_hash='',reset_token_expires_at=NULL
        WHERE customer_id=? AND id!=? AND status IN ('PENDING','APPROVED')`)
        .run(request.customer_id,request.id);
      db.prepare(`UPDATE password_reset_requests
        SET status='USED',used=1,reset_token_expires_at=NULL
        WHERE id=?`).run(request.id);
      return {customerId:customer.id,email:customer.email};
    })();
    if (!updated)
      return res.status(403).json({error:"Your administrator approval is not active for this Gmail address and browser. Submit a new password-reset request."});
    res.clearCookie(passwordResetCookieName,passwordResetCookieClearOptions);
    invalidateCustomerSessions(updated.customerId,updated.email,error=>{
      if(error) {
        console.error("Customer sessions could not be invalidated after password reset:",error);
        return res.status(500).json({error:"Your password was updated, but existing sessions could not be cleared. Please contact the administrator."});
      }
      res.json({message:"Password updated successfully. Please sign in."});
    });
  } catch(error) {
    console.error("Administrator-approved password reset failed:",error);
    res.status(500).json({error:"Could not update your password. Please try again."});
  }
});
app.post("/api/auth/logout", requireCustomer, (req,res) => { req.session.destroy(()=>res.json({message:"Signed out."})); });
app.post("/api/auth/admin-session", requireCustomer, (req,res) => {
  const customer=db.prepare("SELECT id,email FROM customers WHERE id=?").get(req.session.customerId);
  if(!customer) return res.status(401).json({error:"Please sign in to your account again."});
  const admin=db.prepare("SELECT id FROM admins WHERE email=? COLLATE NOCASE").get(customer.email);
  if(!admin) return res.status(403).json({error:"This account does not have administrator access."});
  const customerId=customer.id, adminId=admin.id;
  req.session.regenerate(error=>{
    if(error) {
      console.error("Admin portal session could not be started:",error);
      return res.status(500).json({error:"Could not open the administrator panel. Please try again."});
    }
    req.session.customerId=customerId;
    req.session.adminId=adminId;
    res.json({message:"Administrator access verified."});
  });
});
app.patch("/api/auth/profile", requireCustomer, (req,res) => {
  const body=req.body||{};
  const name=String(body.name||"").trim(), phone=String(body.phone||"").trim();
  if(!name) return res.status(400).json({error:"Name is required."});
  if(name.length>100) return res.status(400).json({error:"Name must be 100 characters or fewer."});
  if(phone.length>30) return res.status(400).json({error:"Phone number must be 30 characters or fewer."});
  if(phone && !/^(?:\+?91[\s-]?)?[6-9]\d{9}$/.test(phone.replace(/[\s()-]/g,""))) return res.status(400).json({error:"Enter a valid Indian phone number."});
  const primary=db.prepare("SELECT * FROM customer_addresses WHERE customer_id=? AND is_default=1").get(req.session.customerId);
  const existing=db.prepare("SELECT address,phone,phone_verified_at FROM customers WHERE id=?").get(req.session.customerId);
  const address=primary?formatDeliveryAddress(primary):String(body.address??existing.address??"").trim();
  if(address.length>600) return res.status(400).json({error:"Address must be 600 characters or fewer."});
  const verifiedAt=normalizeStoredPhone(phone)===normalizeStoredPhone(existing.phone)?existing.phone_verified_at:null;
  db.prepare("UPDATE customers SET name=?,phone=?,phone_verified_at=?,address=?,updated_at=? WHERE id=?")
    .run(name,phone,verifiedAt,address,serverTimestamp(),req.session.customerId);
  res.json({customer:publicCustomer(db.prepare("SELECT * FROM customers WHERE id=?").get(req.session.customerId))});
});
app.patch("/api/auth/password", requireCustomer, (req,res) => {
  const body=req.body||{};
  const currentPassword=String(body.currentPassword||""), password=String(body.password||""), confirmPassword=String(body.confirmPassword||"");
  const customer=db.prepare("SELECT password_hash FROM customers WHERE id=?").get(req.session.customerId);
  if(!customer) return res.status(404).json({error:"Your account could not be found."});
  if(!customer.password_hash || !bcrypt.compareSync(currentPassword,customer.password_hash)) return res.status(400).json({error:"Your current password is incorrect."});
  if(password.length<6||password.length>12) return res.status(400).json({error:"Choose a new password with 6–12 characters."});
  if(password!==confirmPassword) return res.status(400).json({error:"New passwords do not match."});
  if(bcrypt.compareSync(password,customer.password_hash)) return res.status(400).json({error:"Choose a password different from your current password."});
  const passwordHash=bcrypt.hashSync(password,12);
  db.transaction(()=>{
    db.prepare("UPDATE customers SET password_hash=?,updated_at=? WHERE id=?").run(passwordHash,serverTimestamp(),req.session.customerId);
    db.prepare("UPDATE admins SET password_hash=? WHERE email=(SELECT email FROM customers WHERE id=?) COLLATE NOCASE").run(passwordHash,req.session.customerId);
  })();
  res.json({message:"Your password has been changed."});
});
app.get("/api/auth/addresses", requireCustomer, (req,res) => {
  const addresses=db.prepare("SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC,id ASC").all(req.session.customerId);
  res.json({addresses});
});
app.post("/api/auth/addresses", requireCustomer, (req,res) => {
  const result=normalizeAddress(req.body||{});
  if(result.error) return res.status(400).json({error:result.error});
  const customerId=req.session.customerId, now=serverTimestamp();
  const create=db.transaction(() => {
    const count=db.prepare("SELECT COUNT(*) AS total FROM customer_addresses WHERE customer_id=?").get(customerId).total;
    const hasDefault=Boolean(db.prepare("SELECT 1 FROM customer_addresses WHERE customer_id=? AND is_default=1").get(customerId));
    if(count>=(hasDefault?5:4)) return {limit:true};
    const isDefault=Boolean(req.body.is_default)||!count;
    if(isDefault) db.prepare("UPDATE customer_addresses SET is_default=0 WHERE customer_id=?").run(customerId);
    const a=result.address;
    const info=db.prepare(`INSERT INTO customer_addresses(customer_id,recipient_name,phone,house,street,city,state,pin_code,country,landmark,label,is_default,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(customerId,a.recipient_name,a.phone,a.house,a.street,a.city,a.state,a.pin_code,a.country,a.landmark,a.label,isDefault?1:0,now,now);
    if(isDefault) db.prepare("UPDATE customers SET address=?,updated_at=? WHERE id=?").run(formatDeliveryAddress(a),now,customerId);
    return {id:Number(info.lastInsertRowid)};
  });
  const created=create();
  if(created.limit) return res.status(409).json({error:"You can save up to four additional delivery addresses."});
  res.status(201).json({address:db.prepare("SELECT * FROM customer_addresses WHERE id=? AND customer_id=?").get(created.id,customerId)});
});
app.patch("/api/auth/addresses/:id", requireCustomer, (req,res) => {
  const result=normalizeAddress(req.body||{});
  if(result.error) return res.status(400).json({error:result.error});
  const id=Number(req.params.id), customerId=req.session.customerId, now=serverTimestamp(), a=result.address;
  const existing=db.prepare("SELECT id,is_default FROM customer_addresses WHERE id=? AND customer_id=?").get(id,customerId);
  if(!existing) return res.status(404).json({error:"Address not found."});
  const save=db.transaction(() => {
    db.prepare(`UPDATE customer_addresses SET recipient_name=?,phone=?,house=?,street=?,city=?,state=?,pin_code=?,country=?,landmark=?,label=?,updated_at=? WHERE id=? AND customer_id=?`)
      .run(a.recipient_name,a.phone,a.house,a.street,a.city,a.state,a.pin_code,a.country,a.landmark,a.label,now,id,customerId);
    if(existing.is_default) db.prepare("UPDATE customers SET address=?,updated_at=? WHERE id=?").run(formatDeliveryAddress(a),now,customerId);
    else db.prepare("UPDATE customers SET updated_at=? WHERE id=?").run(now,customerId);
  });
  save();
  res.json({address:db.prepare("SELECT * FROM customer_addresses WHERE id=? AND customer_id=?").get(id,customerId)});
});
app.patch("/api/auth/addresses/:id/default", requireCustomer, (req,res) => {
  const id=Number(req.params.id), customerId=req.session.customerId, now=serverTimestamp();
  const address=db.prepare("SELECT * FROM customer_addresses WHERE id=? AND customer_id=?").get(id,customerId);
  if(!address) return res.status(404).json({error:"Address not found."});
  db.transaction(() => {
    db.prepare("UPDATE customer_addresses SET is_default=0 WHERE customer_id=?").run(customerId);
    db.prepare("UPDATE customer_addresses SET is_default=1,updated_at=? WHERE id=? AND customer_id=?").run(now,id,customerId);
    db.prepare("UPDATE customers SET address=?,updated_at=? WHERE id=?").run(formatDeliveryAddress(address),now,customerId);
  })();
  res.json({addresses:db.prepare("SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC,id ASC").all(customerId)});
});
app.delete("/api/auth/addresses/:id", requireCustomer, (req,res) => {
  const id=Number(req.params.id), customerId=req.session.customerId, now=serverTimestamp();
  const address=db.prepare("SELECT id,is_default FROM customer_addresses WHERE id=? AND customer_id=?").get(id,customerId);
  if(!address) return res.status(404).json({error:"Address not found."});
  const remove=db.transaction(() => {
    db.prepare("DELETE FROM customer_addresses WHERE id=? AND customer_id=?").run(id,customerId);
    let nextDefault=null;
    if(address.is_default) {
      nextDefault=db.prepare("SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY id ASC LIMIT 1").get(customerId);
      if(nextDefault) db.prepare("UPDATE customer_addresses SET is_default=1,updated_at=? WHERE id=?").run(now,nextDefault.id);
      db.prepare("UPDATE customers SET address=?,updated_at=? WHERE id=?").run(nextDefault?formatDeliveryAddress(nextDefault):"",now,customerId);
    } else {
      db.prepare("UPDATE customers SET updated_at=? WHERE id=?").run(now,customerId);
    }
  });
  remove();
  res.json({message:"Address deleted.",addresses:db.prepare("SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC,id ASC").all(customerId)});
});
app.get("/api/auth/orders", requireCustomer, (req,res) => {
  const customer=db.prepare("SELECT email FROM customers WHERE id=?").get(req.session.customerId);
  if (!customer) return res.status(401).json({error:"Please sign in to view your account."});
  const rows=db.prepare(`
    SELECT * FROM orders
    WHERE customer_id=? OR (customer_id IS NULL AND email=? COLLATE NOCASE)
    ORDER BY created_at DESC
  `).all(req.session.customerId,customer.email);
  const getUpdates=db.prepare("SELECT status,note,changed_by,created_at FROM order_status_updates WHERE order_id=? ORDER BY id ASC");
  res.json(rows.map(o=>({...o,items:JSON.parse(o.items_json),status_updates:getUpdates.all(o.id)})));
});
const otpPepper=String(process.env.SESSION_SECRET||"development-only-change-this-secret");
const hashOtpIdentity=value=>crypto.createHmac("sha256",otpPepper).update(value).digest("hex");
const configuredSmtp=()=>({
  host:String(process.env.SMTP_HOST||"smtp.gmail.com").trim(),
  port:Number(process.env.SMTP_PORT||465),
  secure:process.env.SMTP_SECURE ? process.env.SMTP_SECURE==="true" : true,
  user:String(process.env.SMTP_USER||"").trim(),
  pass:String(process.env.SMTP_PASS||"").trim(),
  from:String(process.env.SMTP_FROM||process.env.SMTP_USER||"").trim()
});
function normalizeStoredPhone(value) {
  const digits=String(value||"").replace(/\D/g,"");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (digits.startsWith("91")&&digits.length===12&&/^[6-9]\d{9}$/.test(digits.slice(2))) return `+${digits}`;
  return digits.length>=7&&digits.length<=15?`+${digits}`:"";
}
async function createEmailResetOtp({identityHash,customer,requestIp}) {
  const smtp=configuredSmtp();
  if (!smtp.user||!smtp.pass||!smtp.from)
    return {status:503,error:"Email verification is not configured yet. Please contact the store administrator."};
  const purpose="password_reset_email";
  const now=Date.now();
  db.prepare("DELETE FROM password_reset_otps WHERE created_at<?").run(now-24*60*60*1000);
  const recent=db.prepare("SELECT 1 FROM password_reset_otps WHERE purpose=? AND email_hash=? AND created_at>?")
    .get(purpose,identityHash,now-60*1000);
  const recentIp=db.prepare("SELECT COUNT(*) AS count FROM password_reset_otps WHERE request_ip=? AND created_at>?")
    .get(requestIp,now-60*60*1000);
  if (recent||recentIp.count>=10) return {status:429,error:"Please wait before requesting another code."};
  const otp=customer?String(crypto.randomInt(0,1000000)).padStart(6,"0"):"";
  const otpHash=otp
    ? crypto.createHmac("sha256",otpPepper).update(`${customer.id}:${purpose}:${identityHash}:${otp}`).digest("hex")
    : "";
  const insert=db.prepare(`
    INSERT INTO password_reset_otps(customer_id,email_hash,purpose,otp_hash,reset_token_hash,request_ip,created_at,expires_at)
    VALUES(?,?,?,?, '',?,?,?)
  `).run(customer?.id||null,identityHash,purpose,otpHash,requestIp,now,now+10*60*1000);
  if (otp) {
    try {
      const transporter=nodemailer.createTransport({
        host:smtp.host,port:smtp.port,secure:smtp.secure,
        auth:{user:smtp.user,pass:smtp.pass}
      });
      await transporter.sendMail({
        from:smtp.from,
        to:customer.email,
        subject:"Your BS Handlooms password reset code",
        text:`Your password reset code is ${otp}. It expires in 10 minutes. Do not share this code with anyone.`,
        html:`<p>Your BS Handlooms password reset code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">${otp}</p><p>This code expires in 10 minutes. Do not share it with anyone.</p>`
      });
    } catch(error) {
      db.prepare("UPDATE password_reset_otps SET used=1 WHERE id=?").run(insert.lastInsertRowid);
      console.error("Password reset email could not be sent:",error.message);
      return {status:502,error:"We could not send a verification code right now. Please try again later."};
    }
  }
  return {status:200};
}
function consumeOtpChallenge({purpose,identityHash,otp}) {
  return db.transaction(()=>{
    const challenge=db.prepare(`
      SELECT * FROM password_reset_otps
      WHERE purpose=? AND email_hash=? AND used=0 AND expires_at>? AND customer_id IS NOT NULL
      ORDER BY id DESC LIMIT 1
    `).get(purpose,identityHash,Date.now());
    if (!challenge||challenge.attempts>=5) return {invalid:true};
    const expected=crypto.createHmac("sha256",otpPepper)
      .update(`${challenge.customer_id}:${purpose}:${identityHash}:${otp}`).digest("hex");
    const expectedBuffer=Buffer.from(challenge.otp_hash,"hex");
    const suppliedBuffer=Buffer.from(expected,"hex");
    if (expectedBuffer.length!==suppliedBuffer.length||!crypto.timingSafeEqual(expectedBuffer,suppliedBuffer)) {
      const attempts=challenge.attempts+1;
      db.prepare("UPDATE password_reset_otps SET attempts=?,used=? WHERE id=?")
        .run(attempts,attempts>=5?1:0,challenge.id);
      return {invalid:true};
    }
    return {challenge};
  })();
}
const resetPasswordPolicy=password=>password.length>=10&&/[a-z]/.test(password)&&/[A-Z]/.test(password)&&/\d/.test(password);

app.post("/api/auth/forgot-password/email",async (req,res)=>{
  return res.status(410).json({error:"Email recovery is disabled. Sign in to change your password."});
  const email=String((req.body||{}).email||"").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@gmail\.com$/i.test(email)||email.length>254)
    return res.status(400).json({error:"Enter a valid Gmail address."});
  const identityHash=hashOtpIdentity(`email:${email}`);
  const customer=db.prepare("SELECT id,email FROM customers WHERE email=? COLLATE NOCASE").get(email)||null;
  const result=await createEmailResetOtp({
    identityHash,customer,requestIp:String(req.ip||"unknown").slice(0,100)
  });
  if (result.status!==200) return res.status(result.status).json({error:result.error});
  res.json({message:"If an account exists for that email, a verification code has been sent."});
});
app.post("/api/auth/reset-password/email/verify",(req,res)=>{
  return res.status(410).json({error:"Email recovery is disabled. Sign in to change your password."});
  const email=String((req.body||{}).email||"").trim().toLowerCase();
  const otp=String((req.body||{}).otp||"").trim();
  if (!/^[a-z0-9._%+-]+@gmail\.com$/i.test(email)||email.length>254||!/^\d{6}$/.test(otp))
    return res.status(400).json({error:"The verification code is invalid or expired. Request a new one."});
  const identityHash=hashOtpIdentity(`email:${email}`);
  const result=consumeOtpChallenge({purpose:"password_reset_email",identityHash,otp});
  if (result.invalid) return res.status(400).json({error:"The verification code is incorrect or expired."});
  const customer=db.prepare("SELECT id FROM customers WHERE id=? AND email=? COLLATE NOCASE")
    .get(result.challenge.customer_id,email);
  if (!customer) return res.status(400).json({error:"The verification code is invalid or expired. Request a new one."});
  const resetToken=crypto.randomBytes(32).toString("hex");
  const resetTokenHash=crypto.createHmac("sha256",otpPepper).update(resetToken).digest("hex");
  db.prepare("UPDATE password_reset_otps SET used=1,reset_token_hash=? WHERE id=?")
    .run(resetTokenHash,result.challenge.id);
  res.json({message:"Email verification successful. Choose a new password.",resetToken});
});
app.post("/api/auth/reset-password/email/complete",(req,res)=>{
  return res.status(410).json({error:"Email recovery is disabled. Sign in to change your password."});
  const resetToken=String((req.body||{}).resetToken||"").trim();
  const password=String((req.body||{}).password||"");
  const confirmPassword=String((req.body||{}).confirmPassword||"");
  if (!resetToken||resetToken.length>128) return res.status(400).json({error:"Your verification session is invalid. Request a new code."});
  if (!resetPasswordPolicy(password))
    return res.status(400).json({error:"Use at least 10 characters, including an uppercase letter, a lowercase letter, and a number."});
  if (password!==confirmPassword) return res.status(400).json({error:"Passwords do not match."});
  const tokenHash=crypto.createHmac("sha256",otpPepper).update(resetToken).digest("hex");
  const now=Date.now();
  try {
    const updated=db.transaction(()=>{
      const reset=db.prepare(`
        SELECT id,customer_id FROM password_reset_otps
        WHERE purpose='password_reset_email' AND reset_token_hash=? AND used=1 AND expires_at>?
        ORDER BY id DESC LIMIT 1
      `).get(tokenHash,now);
      if (!reset) return false;
      const passwordHash=bcrypt.hashSync(password,12);
      db.prepare("UPDATE customers SET password_hash=?,updated_at=? WHERE id=?").run(passwordHash,serverTimestamp(),reset.customer_id);
      db.prepare("UPDATE admins SET password_hash=? WHERE email=(SELECT email FROM customers WHERE id=?) COLLATE NOCASE").run(passwordHash,reset.customer_id);
      db.prepare("UPDATE password_reset_otps SET reset_token_hash='' WHERE customer_id=? AND purpose='password_reset_email'").run(reset.customer_id);
      db.prepare("UPDATE password_resets SET used=1 WHERE customer_id=?").run(reset.customer_id);
      return true;
    })();
    if (!updated) return res.status(400).json({error:"Your verification session is invalid or expired. Request a new code."});
    res.json({message:"Password reset successfully. Please log in with your new password."});
  } catch(error) {
    console.error("Password reset after email verification failed:",error);
    res.status(500).json({error:"Could not update the password. Please try again."});
  }
});
app.patch("/api/auth/orders/:id/cancel", requireCustomer, (req,res) => {
  const id=Number(req.params.id);
  if (!Number.isInteger(id)||id<=0) return res.status(400).json({error:"Invalid order."});
  try {
    const result=db.transaction(() => {
      const customer=db.prepare("SELECT email FROM customers WHERE id=?").get(req.session.customerId);
      if (!customer) return {notFound:true};
      const order=db.prepare(`
        SELECT id,status FROM orders
        WHERE id=? AND (customer_id=? OR (customer_id IS NULL AND email=? COLLATE NOCASE))
      `).get(id,req.session.customerId,customer.email);
      if (!order) return {notFound:true};
      if (order.status!=="New") {
        throw Object.assign(new Error("This order can no longer be cancelled. Orders may only be cancelled before administrator confirmation; returns are not accepted after delivery."),{statusCode:409});
      }
      const now=serverTimestamp();
      const reason="Cancelled by customer before administrator confirmation.";
      db.prepare(`
        UPDATE orders SET status='Cancelled',cancellation_date=?,cancellation_reason=?
        WHERE id=? AND status='New'
          AND (customer_id=? OR (customer_id IS NULL AND email=? COLLATE NOCASE))
      `).run(now,reason,id,req.session.customerId,customer.email);
      db.prepare("INSERT INTO order_status_updates(order_id,status,note,changed_by,created_at) VALUES(?,'Cancelled',?,'customer',?)")
        .run(id,reason,now);
      db.prepare("INSERT INTO order_stock_adjustments(order_id,product_id,product_name,action,quantity,reason,created_at) VALUES(?,NULL,'','cancel_no_deduction',0,?,?)")
        .run(id,reason,now);
      return {cancelled:true};
    })();
    if (result.notFound) return res.status(404).json({error:"Order not found."});
    res.json({message:"Your order has been cancelled."});
  } catch(error) {
    res.status(error.statusCode||400).json({error:error.message||"Could not cancel the order."});
  }
});
app.post("/api/auth/forgot-password", async (req,res) => {
  return res.status(410).json({error:"Email recovery is disabled. Sign in to change your password."});
  const email=String((req.body||{}).email||"").trim().toLowerCase();
  const c=db.prepare("SELECT * FROM customers WHERE email=? COLLATE NOCASE").get(email);
  // Always return the same public response to avoid revealing whether an account exists.
  if(c) {
    const raw=crypto.randomBytes(32).toString("hex"), hash=crypto.createHash("sha256").update(raw).digest("hex"), expires=Date.now()+30*60*1000;
    db.prepare("INSERT INTO password_resets(customer_id,token_hash,expires_at) VALUES(?,?,?)").run(c.id,hash,expires);
    const base=(process.env.APP_BASE_URL||`http://localhost:${PORT}`).replace(/\/$/,"");
    const smtpUser=String(process.env.SMTP_USER||"").trim();
    const smtpPass=String(process.env.SMTP_PASS||"").trim();
    if(smtpUser&&smtpPass) {
      const smtpHost=String(process.env.SMTP_HOST||"smtp.gmail.com").trim();
      const smtpPort=Number(process.env.SMTP_PORT||465);
      const smtpSecure=process.env.SMTP_SECURE ? process.env.SMTP_SECURE==="true" : true;
      try {
        const transporter=nodemailer.createTransport({
          host:smtpHost,port:smtpPort,secure:smtpSecure,
          auth:{user:smtpUser,pass:smtpPass}
        });
        await transporter.sendMail({
          from:process.env.SMTP_FROM||smtpUser,
          to:c.email,
          subject:"Reset your BS Handlooms password",
          text:`Use this link within 30 minutes to reset your password: ${base}/reset-password?token=${raw}`,
          html:`<p>Use the link below within 30 minutes to reset your BS Handlooms password.</p><p><a href="${base}/reset-password?token=${raw}">Reset password</a></p>`
        });
      } catch(e) {
        console.error("Password reset email could not be sent:",e.message);
      }
    } else if(process.env.NODE_ENV!=="production") console.log(`Development password reset link for ${email}: ${base}/reset-password?token=${raw}`);
  }
  res.json({message:"If an account exists for that email, password-reset instructions will be sent if email delivery is configured."});
});
app.post("/api/auth/reset-password", (req,res) => {
  return res.status(410).json({error:"Email recovery is disabled. Sign in to change your password."});
  const body=req.body||{};
  const token=String(body.token||""), password=String(body.password||"");
  if(password.length<8) return res.status(400).json({error:"Choose a password with at least 8 characters."});
  const hash=crypto.createHash("sha256").update(token).digest("hex"), reset=db.prepare("SELECT * FROM password_resets WHERE token_hash=? AND used=0 AND expires_at>? ORDER BY id DESC").get(hash,Date.now());
  if(!reset) return res.status(400).json({error:"This reset link is invalid or expired. Request a new one."});
  const passwordHash=bcrypt.hashSync(password,12);
  db.transaction(()=>{
    db.prepare("UPDATE customers SET password_hash=?,updated_at=? WHERE id=?").run(passwordHash,serverTimestamp(),reset.customer_id);
    db.prepare("UPDATE admins SET password_hash=? WHERE email=(SELECT email FROM customers WHERE id=?) COLLATE NOCASE").run(passwordHash,reset.customer_id);
    db.prepare("UPDATE password_resets SET used=1 WHERE customer_id=?").run(reset.customer_id);
  })();
  res.json({message:"Password updated. You can now sign in."});
});

app.get("/api/admin/owner-setup/status", (req,res) => {
  const owner=db.prepare("SELECT id FROM admins WHERE email=? COLLATE NOCASE AND role='owner'").get(MAIN_ADMIN_EMAIL);
  const token=String(process.env.MAIN_ADMIN_SETUP_TOKEN||"");
  res.json({available:!owner&&token.length>=32,mainAdminEmail:MAIN_ADMIN_EMAIL});
});
app.post("/api/admin/owner-setup", (req,res) => {
  const body=req.body||{};
  const email=String(body.email||"").trim().toLowerCase();
  const password=String(body.password||"");
  const setupToken=String(body.setupToken||"");
  const configuredToken=String(process.env.MAIN_ADMIN_SETUP_TOKEN||"");
  if(configuredToken.length<32) return res.status(503).json({error:"Initial owner setup is not enabled. Configure a secure setup token on the server first."});
  const suppliedBuffer=Buffer.from(setupToken), configuredBuffer=Buffer.from(configuredToken);
  if(suppliedBuffer.length!==configuredBuffer.length||!crypto.timingSafeEqual(suppliedBuffer,configuredBuffer))
    return res.status(403).json({error:"The initial setup token is incorrect."});
  if(email!==MAIN_ADMIN_EMAIL) return res.status(403).json({error:`Initial setup is limited to ${MAIN_ADMIN_EMAIL}.`});
  const customer=db.prepare("SELECT password_hash FROM customers WHERE email=? COLLATE NOCASE").get(MAIN_ADMIN_EMAIL);
  if(!customer||!customer.password_hash||!bcrypt.compareSync(password,customer.password_hash))
    return res.status(401).json({error:"Register the designated Main Admin account and enter its current customer-account password."});
  try {
    const now=serverTimestamp();
    const ownerId=db.transaction(()=>{
      if(db.prepare("SELECT 1 FROM admins WHERE role='owner'").get())
        throw Object.assign(new Error("A Main Admin is already configured."),{statusCode:409});
      const existing=db.prepare("SELECT id FROM admins WHERE email=? COLLATE NOCASE").get(MAIN_ADMIN_EMAIL);
      if(existing) {
        db.prepare("UPDATE admins SET email=?,password_hash=?,role='owner',granted_by='Initial setup',granted_at=? WHERE id=?")
          .run(MAIN_ADMIN_EMAIL,customer.password_hash,now,existing.id);
        db.prepare("INSERT INTO admin_access_audit(actor_email,target_email,action,created_at) VALUES(?,?,?,?)")
          .run(MAIN_ADMIN_EMAIL,MAIN_ADMIN_EMAIL,"owner_setup",now);
        return existing.id;
      }
      const result=db.prepare("INSERT INTO admins(email,password_hash,role,granted_by,granted_at) VALUES(?,?,'owner','Initial setup',?)")
        .run(MAIN_ADMIN_EMAIL,customer.password_hash,now);
      db.prepare("INSERT INTO admin_access_audit(actor_email,target_email,action,created_at) VALUES(?,?,?,?)")
        .run(MAIN_ADMIN_EMAIL,MAIN_ADMIN_EMAIL,"owner_setup",now);
      return Number(result.lastInsertRowid);
    })();
    res.status(201).json({message:"Main Admin setup is complete. You can now sign in to the admin portal.",adminId:ownerId});
  } catch(error) {
    if(error.statusCode===409) return res.status(409).json({error:error.message});
    console.error("Main Admin initial setup failed:",error);
    res.status(500).json({error:"Could not complete Main Admin setup."});
  }
});
app.post("/api/admin/login", (req,res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const admin = db.prepare("SELECT * FROM admins WHERE email=? COLLATE NOCASE").get(email);
  const ownerCustomer=email===MAIN_ADMIN_EMAIL?db.prepare("SELECT password_hash FROM customers WHERE email=? COLLATE NOCASE").get(MAIN_ADMIN_EMAIL):null;
  const passwordHash=email===MAIN_ADMIN_EMAIL?ownerCustomer?.password_hash:admin?.password_hash;
  if (!admin || !passwordHash || !bcrypt.compareSync(password, passwordHash)) return res.status(401).json({error:"Email or password is incorrect."});
  if(email===MAIN_ADMIN_EMAIL&&admin.role!=="owner") return res.status(403).json({error:"Complete secure Main Admin setup before using the owner account."});
  req.session.regenerate(err => {
    if (err) return res.status(500).json({error:"Could not start admin session."});
    req.session.adminId = admin.id;
    res.json({message:"Signed in."});
  });
});
app.post("/api/admin/logout", requireAdmin, (req,res) => req.session.destroy(() => res.json({message:"Signed out."})));
app.get("/api/admin/me", (req,res) => {
  if(!req.session.adminId) return res.json({authenticated:false});
  const admin=db.prepare("SELECT id,email,role FROM admins WHERE id=?").get(req.session.adminId);
  if(!admin) {
    req.session.adminId=null;
    return res.json({authenticated:false});
  }
  const email=String(admin.email).toLowerCase();
  const isMainAdmin=admin.role==="owner"&&email===MAIN_ADMIN_EMAIL&&Boolean(db.prepare("SELECT 1 FROM customers WHERE email=? COLLATE NOCASE").get(MAIN_ADMIN_EMAIL));
  res.json({authenticated:true,email,role:isMainAdmin?"owner":"admin",isMainAdmin});
});
app.get("/api/admin/contact", requireAdmin, (req,res) => {
  res.json({
    ...db.prepare("SELECT phone,email,address,updated_at FROM contact_details WHERE id=1").get(),
    canEdit: req.admin.isMainAdmin
  });
});
app.put("/api/admin/contact", requireAdmin, requireMainAdmin, (req,res) => {
  const body=req.body||{};
  const phone=String(body.phone||"").trim();
  const email=String(body.email||"").trim().toLowerCase();
  const address=String(body.address||"").trim();
  if (!phone||phone.length>30||!/^\+?[0-9][0-9\s().-]{5,28}[0-9]$/.test(phone))
    return res.status(400).json({error:"Enter a valid contact phone number."});
  if (!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({error:"Enter a valid contact email address."});
  if (!address||address.length>300)
    return res.status(400).json({error:"Enter an address of up to 300 characters."});
  const updatedAt=serverTimestamp();
  db.prepare("UPDATE contact_details SET phone=?,email=?,address=?,updated_at=? WHERE id=1")
    .run(phone,email,address,updatedAt);
  res.json({message:"Contact details saved and published.",phone,email,address,updated_at:updatedAt,canEdit:true});
});
app.get("/api/admin/reviews", requireAdmin, (req,res) => {
  const status=String(req.query.status||"all").toLowerCase();
  if (!["all","pending","approved","rejected"].includes(status))
    return res.status(400).json({error:"Choose a valid review status filter."});
  const reviews=status==="all"
    ? db.prepare("SELECT id,customer_name,customer_email,rating,description,status,created_at FROM reviews ORDER BY created_at DESC,id DESC").all()
    : db.prepare("SELECT id,customer_name,customer_email,rating,description,status,created_at FROM reviews WHERE status=? ORDER BY created_at DESC,id DESC").all(status);
  res.json({reviews});
});
app.patch("/api/admin/reviews/:id/status", requireAdmin, (req,res) => {
  const status=String((req.body||{}).status||"").toLowerCase();
  if (!["approved","rejected"].includes(status))
    return res.status(400).json({error:"Review status must be approved or rejected."});
  const result=db.prepare("UPDATE reviews SET status=? WHERE id=?").run(status,Number(req.params.id));
  if (!result.changes) return res.status(404).json({error:"Review not found."});
  res.json({message:`Review ${status}.`});
});
app.get("/api/admin/access-management", requireAdmin, requireMainAdmin, (req,res) => {
  const admins=db.prepare(`
    SELECT id,email,role,granted_by,granted_at
    FROM admins ORDER BY CASE WHEN role='owner' THEN 0 ELSE 1 END,email COLLATE NOCASE
  `).all();
  const audit=db.prepare(`
    SELECT id,actor_email,target_email,action,created_at
    FROM admin_access_audit ORDER BY id DESC LIMIT 200
  `).all();
  res.json({admins, audit, mainAdminEmail:MAIN_ADMIN_EMAIL});
});
app.post("/api/admin/access-management", requireAdmin, requireMainAdmin, (req,res) => {
  const email=String((req.body||{}).email||"").trim().toLowerCase();
  if(!/^[a-z0-9._%+-]+@gmail\.com$/i.test(email)) return res.status(400).json({error:"Enter a valid Gmail address."});
  if(email===MAIN_ADMIN_EMAIL) return res.status(400).json({error:"The Main Admin already has owner access."});
  const customer=db.prepare("SELECT id,password_hash FROM customers WHERE email=? COLLATE NOCASE").get(email);
  if(!customer) return res.status(404).json({error:"No registered user was found for that Gmail address. Ask them to register first."});
  if(!customer.password_hash) return res.status(409).json({error:"This user must set an account password before admin access can be granted."});
  if(db.prepare("SELECT id FROM admins WHERE email=? COLLATE NOCASE").get(email))
    return res.status(409).json({error:"This user already has administrator access."});
  const now=serverTimestamp();
  try {
    const created=db.transaction(()=>{
      const result=db.prepare("INSERT INTO admins(email,password_hash,role,granted_by,granted_at) VALUES(?,?,'admin',?,?)")
        .run(email,customer.password_hash,req.admin.email,now);
      db.prepare("INSERT INTO admin_access_audit(actor_email,target_email,action,created_at) VALUES(?,?,?,?)")
        .run(req.admin.email,email,"grant",now);
      return Number(result.lastInsertRowid);
    })();
    res.status(201).json({message:`Admin access granted to ${email}.`,id:created});
  } catch(error) {
    if(String(error.message).includes("UNIQUE")) return res.status(409).json({error:"This user already has administrator access."});
    console.error("Administrator access grant failed:",error);
    res.status(500).json({error:"Could not grant administrator access."});
  }
});
app.delete("/api/admin/access-management/:id", requireAdmin, requireMainAdmin, (req,res) => {
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id)||id<=0) return res.status(400).json({error:"Invalid administrator account."});
  const target=db.prepare("SELECT id,email,role FROM admins WHERE id=?").get(id);
  if(!target) return res.status(404).json({error:"Administrator account not found."});
  if(String(target.email).toLowerCase()===MAIN_ADMIN_EMAIL||target.role==="owner")
    return res.status(403).json({error:"Main Admin ownership cannot be revoked."});
  if(target.id===req.admin.id) return res.status(403).json({error:"You cannot revoke your own access through this page."});
  const now=serverTimestamp();
  db.transaction(()=>{
    db.prepare("DELETE FROM admins WHERE id=?").run(id);
    db.prepare("INSERT INTO admin_access_audit(actor_email,target_email,action,created_at) VALUES(?,?,?,?)")
      .run(req.admin.email,target.email,"revoke",now);
  })();
  res.json({message:`Administrator access revoked for ${target.email}.`});
});
app.get("/api/admin/products", requireAdmin, (req,res) => res.json(db.prepare(`
  SELECT p.*,COALESCE(c.active,0) AS category_active,
         EXISTS(SELECT 1 FROM homepage_shop_products hs WHERE hs.product_id=p.id) AS homepage_shop
  FROM products p LEFT JOIN categories c ON c.name=p.category
  ORDER BY p.created_at DESC,p.id DESC
`).all().map(safeProduct)));
app.patch("/api/admin/products/:id/homepage-shop", requireAdmin, (req,res) => {
  const productId = Number(req.params.id);
  if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({error:"Invalid product."});
  if (typeof req.body.selected !== "boolean") return res.status(400).json({error:"Choose whether the product should appear in the homepage shop."});
  const product = db.prepare(`
    SELECT p.id,p.active,c.active AS category_active
    FROM products p LEFT JOIN categories c ON c.name=p.category
    WHERE p.id=?
  `).get(productId);
  if (!product) return res.status(404).json({error:"Product not found."});
  if (req.body.selected && (!product.active || !product.category_active)) {
    return res.status(400).json({error:"Only visible products in active categories can be selected for the homepage."});
  }
  try {
    db.transaction(() => {
      if (req.body.selected) {
        const count = db.prepare("SELECT COUNT(*) AS count FROM homepage_shop_products").get().count;
        if (count >= 8 && !db.prepare("SELECT 1 FROM homepage_shop_products WHERE product_id=?").get(productId)) {
          const error = new Error("The homepage shop already has 8 products. Remove one before adding another.");
          error.status = 409;
          throw error;
        }
        db.prepare("INSERT OR IGNORE INTO homepage_shop_products(product_id,sort_order) VALUES(?,?)")
          .run(productId,count);
      } else {
        const selection = db.prepare("SELECT sort_order FROM homepage_shop_products WHERE product_id=?").get(productId);
        db.prepare("DELETE FROM homepage_shop_products WHERE product_id=?").run(productId);
        if (selection) db.prepare("UPDATE homepage_shop_products SET sort_order=sort_order-1 WHERE sort_order>?").run(selection.sort_order);
      }
    })();
  } catch (error) {
    if (error.status) return res.status(error.status).json({error:error.message});
    console.error("Homepage product selection failed:",error);
    return res.status(500).json({error:"Could not update homepage product selection."});
  }
  res.json({message:req.body.selected ? "Product added to the homepage shop." : "Product removed from the homepage shop."});
});
app.post("/api/admin/uploads", requireAdmin, express.raw({ type: ["image/jpeg", "image/png", "image/webp", "image/gif"], limit: "20mb" }), async (req,res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({error:"Choose an image to upload."});
  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const imageTypes = {
    jpeg: { mime: "image/jpeg", extension: "jpg" },
    png: { mime: "image/png", extension: "png" },
    webp: { mime: "image/webp", extension: "webp" },
    gif: { mime: "image/gif", extension: "gif" }
  };
  const buffer = req.body;
  const detectedType = buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" ? "webp"
    : buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) ? "png"
    : buffer.length >= 6 && ["GIF87a","GIF89a"].includes(buffer.toString("ascii", 0, 6)) ? "gif"
    : buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff ? "jpeg"
    : null;
  if (!detectedType || imageTypes[detectedType].mime !== contentType) {
    return res.status(400).json({error:"Upload a valid JPEG, PNG, WebP, or GIF image."});
  }
  const filename = `${crypto.randomUUID()}.${imageTypes[detectedType].extension}`;
  try {
    await fs.promises.writeFile(path.join(uploadsDir, filename), buffer, { flag: "wx" });
  } catch (error) {
    console.error("Product image upload failed:", error);
    return res.status(500).json({error:"Could not save the uploaded image."});
  }
  res.status(201).json({image:`/uploads/${filename}`});
});
function readProductPayload(data = {}, existingProductId = null) {
  const name = String(data.name || "").trim();
  const categoryInput = normalizeCategoryName(data.category);
  const price = Number(data.price);
  const rawOfferPrice = String(data.offer_price ?? "").trim();
  const enteredOfferPrice = rawOfferPrice === "" ? null : Number(rawOfferPrice);
  const rawDiscountPercent = String(data.discount_percent ?? "").trim();
  let discountPercent = rawDiscountPercent === "" ? 0 : Number(rawDiscountPercent);
  const stock = Number(data.stock);
  const image = String(data.image || "").trim();
  const description = String(data.description || "");
  if (!name || name.length > 120) return {error:"Enter a product name of up to 120 characters."};
  if (!categoryInput || categoryInput.length > 80) return {error:"Enter a product category of up to 80 characters."};
  const selectedCategory = db.prepare("SELECT id,name,active FROM categories WHERE name=? COLLATE NOCASE").get(categoryInput);
  if (!selectedCategory) return {error:"Choose a category from the category list."};
  const category = selectedCategory.name;
  if (!selectedCategory.active) {
    const existingProduct = existingProductId === null ? null : db.prepare("SELECT category FROM products WHERE id=?").get(existingProductId);
    if (!existingProduct || normalizeCategoryName(existingProduct.category).toLowerCase() !== category.toLowerCase())
      return {error:"Choose an active category. Products cannot be moved into an inactive category."};
  }
  if (!Number.isFinite(price) || price <= 0) return {error:"Original price must be greater than ₹0."};
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100)
    return {error:"Discount must be a whole-number percentage from 0 to 100."};
  if (enteredOfferPrice !== null && (!Number.isFinite(enteredOfferPrice) || enteredOfferPrice <= 0 || enteredOfferPrice >= price))
    return {error:"Offer price must be greater than ₹0 and lower than the original price."};
  const offerPrice = enteredOfferPrice !== null
    ? enteredOfferPrice
    : discountPercent > 0 && discountPercent < 100
      ? Math.round(price * (100 - discountPercent)) / 100
      : null;
  if (enteredOfferPrice !== null) discountPercent = Math.max(1,Math.round((price - enteredOfferPrice) * 100 / price));
  if (!Number.isInteger(stock) || stock < 0) return {error:"Enter a valid non-negative stock quantity."};
  if (description.length > 1000) return {error:"Product description must be 1,000 characters or fewer."};
  if (image.length > 2000 || (image && !(/^(https?:\/\/|\/(?!\/))/.test(image)))) return {error:"Product image must be an uploaded image or a valid image URL."};
  return {name,category,price,offer_price:offerPrice,discount_percent:discountPercent,stock,image,description,featured:data.featured ? 1 : 0,active:data.active === false ? 0 : 1};
}
app.post("/api/admin/products", requireAdmin, (req,res) => {
  const product = readProductPayload(req.body);
  if (product.error) return res.status(400).json({error:product.error});
  const info = db.prepare("INSERT INTO products(name,category,price,offer_price,discount_percent,description,image,stock,featured,active) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(product.name,product.category,product.price,product.offer_price,product.discount_percent,product.description,product.image,product.stock,product.featured,product.active);
  res.status(201).json({id:info.lastInsertRowid});
});
app.put("/api/admin/products/:id", requireAdmin, (req,res) => {
  const productId = Number(req.params.id);
  if (!Number.isSafeInteger(productId) || productId <= 0) return res.status(400).json({error:"Invalid product."});
  const product = readProductPayload(req.body,productId);
  if (product.error) return res.status(400).json({error:product.error});
  const result = db.transaction(() => {
    const updated = db.prepare("UPDATE products SET name=?,category=?,price=?,offer_price=?,discount_percent=?,description=?,image=?,stock=?,featured=?,active=? WHERE id=?")
      .run(product.name,product.category,product.price,product.offer_price,product.discount_percent,product.description,product.image,product.stock,product.featured,product.active,productId);
    if (updated.changes) {
      db.prepare("UPDATE special_offer_products SET offer_price=? WHERE product_id=?")
        .run(getProductDiscountedPrice(product),productId);
    }
    return updated;
  })();
  if (!result.changes) return res.status(404).json({error:"Product not found."});
  res.json({message:"Product saved."});
});
app.patch("/api/admin/products/:id/visibility", requireAdmin, (req,res) => {
  if (typeof req.body.active !== "boolean") return res.status(400).json({error:"Choose whether the product should be visible."});
  const result = db.prepare("UPDATE products SET active=? WHERE id=?").run(req.body.active ? 1 : 0,Number(req.params.id));
  if (!result.changes) return res.status(404).json({error:"Product not found."});
  res.json({message:req.body.active ? "Product is visible in the shop." : "Product is hidden from the shop."});
});
app.patch("/api/admin/products/:id/availability", requireAdmin, (req,res) => {
  if (typeof req.body.out_of_stock !== "boolean") return res.status(400).json({error:"Choose the product availability."});
  const product = db.prepare("SELECT id,stock FROM products WHERE id=?").get(Number(req.params.id));
  if (!product) return res.status(404).json({error:"Product not found."});
  if (!req.body.out_of_stock && product.stock < 1)
    return res.status(409).json({error:"Add a stock quantity greater than zero before marking this product in stock."});
  const result = db.prepare("UPDATE products SET out_of_stock=? WHERE id=?").run(req.body.out_of_stock ? 1 : 0,Number(req.params.id));
  res.json({message:req.body.out_of_stock ? "Product marked out of stock." : "Product marked in stock."});
});
app.delete("/api/admin/products/:id", requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  const product = db.prepare("SELECT id FROM products WHERE id=?").get(id);
  if (!product) return res.status(404).json({error:"Product not found."});
  db.transaction(() => {
    db.prepare("DELETE FROM collection_products WHERE product_id=?").run(id);
    db.prepare("DELETE FROM special_offer_products WHERE product_id=?").run(id);
    db.prepare("DELETE FROM products WHERE id=?").run(id);
  })();
  res.json({message:"Product permanently deleted."});
});
app.get("/api/admin/collections", requireAdmin, (req,res) => {
  const rows = db.prepare(`
    SELECT cp.id, cp.product_id, cp.sort_order, cp.active, p.name, p.category, p.price, p.image, p.stock, p.featured, p.out_of_stock
    FROM collection_products cp
    JOIN products p ON p.id = cp.product_id
    ORDER BY cp.sort_order ASC, cp.id ASC
  `).all();
  res.json(rows);
});
app.post("/api/admin/collections", requireAdmin, (req,res) => {
  const productId = Number(req.body.product_id);
  const sortOrder = Number(req.body.sort_order || 0);
  if (!Number.isInteger(productId) || productId <= 0) return res.status(400).json({error:"Choose a valid product."});
  const exists = db.prepare("SELECT id FROM products WHERE id=? AND active=1").get(productId);
  if (!exists) return res.status(404).json({error:"That product is not available."});
  const existing = db.prepare("SELECT id FROM collection_products WHERE product_id=?").get(productId);
  if (existing) return res.status(409).json({error:"This product is already in the New Collection."});
  const info = db.prepare("INSERT INTO collection_products(product_id,sort_order,active) VALUES(?,?,1)").run(productId, sortOrder);
  res.status(201).json({id: info.lastInsertRowid});
});
app.put("/api/admin/collections/:id", requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  const sortOrder = Number(req.body.sort_order || 0);
  const active = req.body.active === false ? 0 : 1;
  const result = db.prepare("UPDATE collection_products SET sort_order=?, active=? WHERE id=?").run(sortOrder, active, id);
  if (!result.changes) return res.status(404).json({error:"Collection item not found."});
  res.json({message:"Collection item updated."});
});
app.delete("/api/admin/collections/:id", requireAdmin, (req,res) => {
  const result = db.prepare("DELETE FROM collection_products WHERE id=?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({error:"Collection item not found."});
  res.json({message:"Collection item removed."});
});
app.get("/api/admin/banners", requireAdmin, (req,res) => {
  const rows = db.prepare("SELECT * FROM offer_banners ORDER BY sort_order ASC, id ASC").all();
  res.json(rows);
});
app.post("/api/admin/banners", requireAdmin, (req,res) => {
  const data = req.body || {};
  const title = String(data.title || "").trim();
  const image = String(data.image || "").trim();
  if (!title || !image) return res.status(400).json({error:"Offer banner title and image are required."});
  const info = db.prepare(`INSERT INTO offer_banners(title,description,image,button_text,button_link,start_date,end_date,active,sort_order)
    VALUES(?,?,?,?,?,?,?,1,?)`).run(title.slice(0,140), String(data.description || "").slice(0,500), image.slice(0,1000), String(data.button_text || "Shop offers").slice(0,80), String(data.button_link || "/products").slice(0,500), String(data.start_date || "").slice(0,30), String(data.end_date || "").slice(0,30), Number(data.sort_order || 0));
  res.status(201).json({id: info.lastInsertRowid});
});
app.put("/api/admin/banners/:id", requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  const data = req.body || {};
  const result = db.prepare(`UPDATE offer_banners SET title=?, description=?, image=?, button_text=?, button_link=?, start_date=?, end_date=?, active=?, sort_order=? WHERE id=?`)
    .run(String(data.title || "").slice(0,140), String(data.description || "").slice(0,500), String(data.image || "").slice(0,1000), String(data.button_text || "Shop offers").slice(0,80), String(data.button_link || "/products").slice(0,500), String(data.start_date || "").slice(0,30), String(data.end_date || "").slice(0,30), data.active === false ? 0 : 1, Number(data.sort_order || 0), id);
  if (!result.changes) return res.status(404).json({error:"Offer banner not found."});
  res.json({message:"Offer banner saved."});
});
app.delete("/api/admin/banners/:id", requireAdmin, (req,res) => {
  const result = db.prepare("DELETE FROM offer_banners WHERE id=?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({error:"Offer banner not found."});
  res.json({message:"Offer banner removed."});
});
app.get("/api/admin/offers", requireAdmin, (req,res) => {
  const rows = db.prepare(`
    SELECT sop.id,sop.product_id,sop.offer_label,sop.start_date,sop.end_date,sop.active,sop.sort_order,sop.featured,
           p.name AS product_name,p.category,p.image,p.price,p.offer_price,p.discount_percent,p.stock
    FROM special_offer_products sop
    JOIN products p ON p.id = sop.product_id
    ORDER BY sop.sort_order ASC, sop.id ASC
  `).all();
  res.json(rows.map(item => ({
    ...item,
    selling_price:getProductDiscountedPrice(item),
    discountPercent:Number(item.discount_percent) || 0,
    active:Boolean(item.active),
    featured:Boolean(item.featured)
  })));
});
app.post("/api/admin/offers", requireAdmin, (req,res) => {
  const data = req.body || {};
  const productId = Number(data.product_id);
  if (!Number.isInteger(productId) || productId <= 0)
    return res.status(400).json({error:"Choose a valid product."});
  const product = db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(productId);
  if (!product) return res.status(404).json({error:"Product not found."});
  const existing = db.prepare("SELECT id FROM special_offer_products WHERE product_id=?").get(productId);
  if (existing) return res.status(409).json({error:"This product is already in the special offer list."});
  const pricing = readProductPayload({...product,...data,featured:product.featured,active:product.active},productId);
  if (pricing.error) return res.status(400).json({error:pricing.error});
  const info = db.transaction(() => {
    db.prepare("UPDATE products SET price=?,offer_price=?,discount_percent=? WHERE id=?")
      .run(pricing.price,pricing.offer_price,pricing.discount_percent,productId);
    const cataloguePrice = getProductDiscountedPrice(pricing);
    return db.prepare(`INSERT INTO special_offer_products(product_id,offer_price,offer_label,start_date,end_date,active,sort_order,featured)
      VALUES(?,?,?,?,?,?,?,?)`).run(productId, cataloguePrice, String(data.offer_label || "").slice(0,80), String(data.start_date || "").slice(0,30), String(data.end_date || "").slice(0,30), data.active === false ? 0 : 1, Number(data.sort_order || 0), data.featured ? 1 : 0);
  })();
  res.status(201).json({id: info.lastInsertRowid});
});
app.put("/api/admin/offers/:id", requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  const data = req.body || {};
  const productId = Number(data.product_id || 0);
  if (!Number.isInteger(productId) || productId <= 0) return res.status(400).json({error:"Choose a valid product."});
  const existingOffer = db.prepare("SELECT id FROM special_offer_products WHERE id=?").get(id);
  if (!existingOffer) return res.status(404).json({error:"Special offer not found."});
  const product = db.prepare("SELECT * FROM products WHERE id=?").get(productId);
  if (!product) return res.status(404).json({error:"Product not found."});
  const conflictingOffer = db.prepare("SELECT id FROM special_offer_products WHERE product_id=? AND id!=?").get(productId,id);
  if (conflictingOffer) return res.status(409).json({error:"This product is already in the special offer list."});
  const pricing = readProductPayload({...product,...data,featured:product.featured,active:product.active},productId);
  if (pricing.error) return res.status(400).json({error:pricing.error});
  db.transaction(() => {
    db.prepare("UPDATE products SET price=?,offer_price=?,discount_percent=? WHERE id=?")
      .run(pricing.price,pricing.offer_price,pricing.discount_percent,productId);
    const cataloguePrice = getProductDiscountedPrice(pricing);
    db.prepare(`UPDATE special_offer_products SET product_id=?, offer_price=?, offer_label=?, start_date=?, end_date=?, active=?, sort_order=?, featured=? WHERE id=?`)
      .run(productId, cataloguePrice, String(data.offer_label || "").slice(0,80), String(data.start_date || "").slice(0,30), String(data.end_date || "").slice(0,30), data.active === false ? 0 : 1, Number(data.sort_order || 0), data.featured ? 1 : 0, id);
  })();
  res.json({message:"Special offer saved."});
});
app.delete("/api/admin/offers/:id", requireAdmin, (req,res) => {
  const result = db.prepare("DELETE FROM special_offer_products WHERE id=?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({error:"Special offer not found."});
  res.json({message:"Special offer removed."});
});
function istDateBoundary(value, advanceDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const [year,month,day]=value.split("-").map(Number);
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day) return null;
  if(advanceDay) date.setUTCDate(date.getUTCDate()+1);
  return Math.floor((date.getTime()-330*60*1000)/1000);
}
function dateRangeClauses(query, column, params) {
  const clauses=[];
  if(query.from) {
    const from=istDateBoundary(query.from);
    if(from===null) return {error:"Enter a valid start date."};
    clauses.push(`CAST(strftime('%s',${column}) AS INTEGER)>=?`); params.push(from);
  }
  if(query.to) {
    const to=istDateBoundary(query.to,true);
    if(to===null) return {error:"Enter a valid end date."};
    clauses.push(`CAST(strftime('%s',${column}) AS INTEGER)<?`); params.push(to);
  }
  return {clauses};
}
function groupedOrderItemsForStock(order) {
  let items;
  try { items = JSON.parse(order.items_json); } catch (error) { throw Object.assign(new Error("Order items could not be read; stock was not changed."),{statusCode:409}); }
  if (!Array.isArray(items) || !items.length) throw Object.assign(new Error("Order has no restorable item details; stock was not changed."),{statusCode:409});
  const grouped = new Map();
  for (const item of items) {
    const productId = Number(item.id);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(quantity) || quantity < 1)
      throw Object.assign(new Error("Order item details are invalid; stock was not changed."),{statusCode:409});
    const existing = grouped.get(productId);
    grouped.set(productId,{product_id:productId,product_name:String(item.name || ""),quantity:(existing?.quantity || 0) + quantity});
  }
  return [...grouped.values()];
}
app.get("/api/admin/customers", requireAdmin, (req,res) => {
  const params=[];
  const range=dateRangeClauses(req.query,"created_at",params);
  if(range.error) return res.status(400).json({error:range.error});
  const sort=req.query.sort==="updated"?"updated_at":"created_at";
  const direction=req.query.direction==="asc"?"ASC":"DESC";
  const where=range.clauses.length?`WHERE ${range.clauses.join(" AND ")}`:"";
  const rows=db.prepare(`SELECT customer.id,customer.name,customer.email,customer.phone,customer.address,customer.created_at,customer.updated_at,
      reset_request.id AS password_reset_request_id,reset_request.status AS password_reset_status,
      reset_request.requested_at AS password_reset_requested_at
    FROM customers customer
    LEFT JOIN password_reset_requests reset_request ON reset_request.id=(
      SELECT MAX(latest.id) FROM password_reset_requests latest WHERE latest.customer_id=customer.id
    )
    ${where ? where.replace(/\bcreated_at\b/g,"customer.created_at").replace(/\bupdated_at\b/g,"customer.updated_at") : ""}
    ORDER BY customer.${sort} ${direction},customer.id ${direction}`).all(...params);
  res.json(rows);
});
app.get("/api/admin/password-reset-requests", requireAdmin, (req,res) => {
  const requests=db.prepare(`SELECT request.id,customer.name,customer.email,request.requested_at,request.approved_at,request.status
    FROM password_reset_requests request
    JOIN customers customer ON customer.id=request.customer_id
    WHERE request.id=(SELECT MAX(latest.id) FROM password_reset_requests latest WHERE latest.customer_id=request.customer_id)
    ORDER BY request.requested_at DESC`).all();
  res.json({requests});
});
function updatePasswordResetRequest(req,res,status) {
  const requestId=Number(req.params.id);
  if(!Number.isInteger(requestId)||requestId<=0) return res.status(400).json({error:"Invalid password-reset request."});
  const request=db.prepare(`SELECT reset_request.id,customer.id AS customer_id,customer.email
    FROM password_reset_requests reset_request
    JOIN customers customer ON customer.id=reset_request.customer_id
    WHERE reset_request.id=? AND reset_request.status='PENDING'`).get(requestId);
  if(!request) return res.status(409).json({error:"This password-reset request is no longer pending."});
  const now=Date.now();
  const updated=db.transaction(()=>{
    const update=db.prepare(`UPDATE password_reset_requests SET status=?,approved_at=?,
      code_hash='',code_expires_at=NULL,reset_token_expires_at=NULL WHERE id=? AND status='PENDING'`)
      .run(status,status==="APPROVED"?now:null,requestId);
    if (!update.changes) return false;
    db.prepare("INSERT INTO admin_access_audit(actor_email,target_email,action,created_at) VALUES(?,?,?,?)")
      .run(req.admin.email,request.email,status==="APPROVED"?"password_reset_approved":"password_reset_rejected",serverTimestamp());
    return true;
  })();
  if(!updated) return res.status(409).json({error:"This password-reset request is no longer pending."});
  res.json({message:status==="APPROVED"
    ?"Password reset approved. The customer can now set a new password in the requesting browser."
    :"Password reset request rejected. The customer may submit a new request."});
}
app.post("/api/admin/password-reset-requests/:id/approve", requireAdmin, (req,res) => {
  updatePasswordResetRequest(req,res,"APPROVED");
});
app.post("/api/admin/password-reset-requests/:id/reject", requireAdmin, (req,res) => {
  updatePasswordResetRequest(req,res,"REJECTED");
});
app.post("/api/admin/customers/:id/password-reset/approve", requireAdmin, (req,res) => {
  const customerId=Number(req.params.id);
  if (!Number.isInteger(customerId)||customerId<=0) return res.status(400).json({error:"Invalid customer."});
  const request=db.prepare(`SELECT id FROM password_reset_requests
    WHERE customer_id=? AND status='PENDING' ORDER BY id DESC LIMIT 1`).get(customerId);
  if(!request) return res.status(409).json({error:"There is no pending password-reset request for this customer."});
  req.params.id=String(request.id);
  updatePasswordResetRequest(req,res,"APPROVED");
});
app.get("/api/admin/customers/:id/addresses", requireAdmin, (req,res) => {
  const customerId=Number(req.params.id);
  if(!Number.isInteger(customerId) || customerId<=0) return res.status(400).json({error:"Invalid customer."});
  const customer=db.prepare("SELECT id,name,email FROM customers WHERE id=?").get(customerId);
  if(!customer) return res.status(404).json({error:"Customer not found."});
  const addresses=db.prepare("SELECT id,recipient_name,phone,house,street,city,state,pin_code,country,landmark,label,is_default,created_at,updated_at FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC,id ASC").all(customerId);
  res.json({customer,addresses});
});
app.get("/api/admin/orders", requireAdmin, (req,res) => {
  const params=[];
  const range=dateRangeClauses(req.query,"created_at",params);
  if(range.error) return res.status(400).json({error:range.error});
  const direction=req.query.direction==="asc"?"ASC":"DESC";
  const where=range.clauses.length?`WHERE ${range.clauses.join(" AND ")}`:"";
  const rows = db.prepare(`SELECT * FROM orders ${where} ORDER BY CAST(strftime('%s',created_at) AS INTEGER) ${direction},id ${direction}`).all(...params);
  const getAdjustments = db.prepare("SELECT id,product_id,product_name,action,quantity,reason,created_at FROM order_stock_adjustments WHERE order_id=? ORDER BY id ASC");
  res.json(rows.map(o => ({...o, items:JSON.parse(o.items_json), stock_adjustments:getAdjustments.all(o.id)})));
});
app.get("/api/admin/orders/clear-audit", requireAdmin, requireMainAdmin, (req,res) => {
  const entries = db.prepare("SELECT actor_email,deleted_orders,created_at FROM order_data_clear_audit ORDER BY id DESC LIMIT 50").all();
  res.json(entries);
});
app.post("/api/admin/orders/clear", requireAdmin, requireMainAdmin, (req,res) => {
  if (String(req.body?.confirmation || "") !== "CLEAR ALL ORDERS")
    return res.status(400).json({error:"Type CLEAR ALL ORDERS exactly to confirm."});
  try {
    const result = db.transaction(() => {
      const deletedOrders = db.prepare("SELECT COUNT(*) AS count FROM orders").get().count;
      db.prepare("DELETE FROM orders").run();
      db.prepare("DELETE FROM sqlite_sequence WHERE name='orders'").run();
      const createdAt = serverTimestamp();
      db.prepare("INSERT INTO order_data_clear_audit(actor_email,deleted_orders,created_at) VALUES(?,?,?)")
        .run(req.admin.email,deletedOrders,createdAt);
      return {deletedOrders,createdAt};
    })();
    res.json({
      message:`Order data cleared. ${result.deletedOrders} order${result.deletedOrders === 1 ? "" : "s"} removed; existing product inventory was not changed.`,
      deleted_orders:result.deletedOrders,
      created_at:result.createdAt
    });
  } catch (error) {
    console.error("Main Admin could not clear order data:",error);
    res.status(500).json({error:"Could not clear order data. No order data was intentionally changed outside the database transaction."});
  }
});
app.patch("/api/admin/orders/:id", requireAdmin, (req,res) => {
  const allowed = ["New","Confirmed","Packed","Shipped","Delivered","Cancelled"];
  const status = String(req.body.status || "");
  if (!allowed.includes(status)) return res.status(400).json({error:"Invalid order status."});
  const cancellationReason = String(req.body.cancellation_reason || "").trim();
  if (status === "Cancelled" && (!cancellationReason || cancellationReason.length > 500))
    return res.status(400).json({error:"Enter a cancellation reason of up to 500 characters."});
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({error:"Invalid order."});
  const transitions = {
    New:["Confirmed","Cancelled"],
    Confirmed:["Packed","Cancelled"],
    Packed:["Shipped","Cancelled"],
    Shipped:["Delivered","Cancelled"]
  };
  const adjustStock = db.prepare("UPDATE products SET stock=stock+?,out_of_stock=0 WHERE id=?");
  const recordAdjustment = db.prepare("INSERT INTO order_stock_adjustments(order_id,product_id,product_name,action,quantity,reason,created_at) VALUES(?,?,?,?,?,?,?)");
  try {
    const result = db.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!order) return {notFound:true};
      if (order.status === status) return {unchanged:true};
      if (!transitions[order.status]?.includes(status))
        throw Object.assign(new Error(`Cannot change an order from ${order.status} to ${status}.`),{statusCode:409});
      const now = serverTimestamp();

      if (status === "Confirmed" && !order.stock_deducted) {
        const items = groupedOrderItemsForStock(order);
        const getProduct = db.prepare("SELECT id,name,stock,active,out_of_stock FROM products WHERE id=?");
        const deductStock = db.prepare("UPDATE products SET stock=stock-? WHERE id=? AND stock>=? AND out_of_stock=0");
        for (const item of items) {
          const product = getProduct.get(item.product_id);
          if (!product || !product.active) throw Object.assign(new Error(`${item.product_name} is no longer available; stock was not deducted.`),{statusCode:409});
          if (product.out_of_stock || product.stock < item.quantity)
            throw Object.assign(new Error(`${product.name} has insufficient available stock to confirm this order.`),{statusCode:409});
          if (!deductStock.run(item.quantity,item.product_id,item.quantity).changes)
            throw Object.assign(new Error(`${product.name} stock changed; refresh and try again.`),{statusCode:409});
          recordAdjustment.run(id,item.product_id,product.name,"confirm_deduct",item.quantity,"Order confirmed.",now);
        }
        db.prepare("UPDATE orders SET stock_deducted=1 WHERE id=?").run(id);
      }

      if (status === "Cancelled") {
        if (order.stock_deducted && !order.stock_restored) {
          if (order.shipped_at) {
            recordAdjustment.run(id,null,"","cancel_after_shipment",0,`No automatic restock after shipment. ${cancellationReason}`,now);
          } else {
            const items = groupedOrderItemsForStock(order);
            for (const item of items) {
              const product = db.prepare("SELECT id,name FROM products WHERE id=?").get(item.product_id);
              if (!product) throw Object.assign(new Error(`${item.product_name} no longer exists; stock could not be restored.`),{statusCode:409});
              adjustStock.run(item.quantity,item.product_id);
              recordAdjustment.run(id,item.product_id,product.name,"cancel_restore",item.quantity,cancellationReason,now);
            }
            const restoredQuantity = items.reduce((sum,item) => sum + item.quantity,0);
            db.prepare("UPDATE orders SET stock_restored=1,restored_quantity=? WHERE id=?").run(restoredQuantity,id);
          }
        } else if (!order.stock_deducted) {
          recordAdjustment.run(id,null,"","cancel_no_deduction",0,`No stock was deducted before cancellation. ${cancellationReason}`,now);
        }
        db.prepare("UPDATE orders SET status=?,cancellation_date=?,cancellation_reason=? WHERE id=?")
          .run(status,now,cancellationReason,id);
      } else if (status === "Shipped") {
        db.prepare("UPDATE orders SET status=?,shipped_at=COALESCE(shipped_at,?) WHERE id=?").run(status,now,id);
      } else {
        db.prepare("UPDATE orders SET status=? WHERE id=?").run(status,id);
      }
      const statusNotes = {
        Confirmed:"Your order has been confirmed and stock reserved.",
        Packed:"Your order has been packed and is preparing for dispatch.",
        Shipped:"Your order has been shipped.",
        Delivered:"Your order has been delivered.",
        Cancelled:`Order cancelled. ${cancellationReason}`
      };
      db.prepare("INSERT INTO order_status_updates(order_id,status,note,changed_by,created_at) VALUES(?,?,?,?,?)")
        .run(id,status,statusNotes[status]||"Order status updated.",`admin:${req.admin.email}`,now);
      return {updated:true};
    })();
    if (result.notFound) return res.status(404).json({error:"Order not found."});
    res.json({message:result.unchanged ? "Order status is unchanged." : "Order status updated."});
  } catch (error) {
    res.status(error.statusCode || 400).json({error:error.message || "Could not update order status."});
  }
});
app.post("/api/admin/orders/:id/approve-return-restock", requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  const reason = String(req.body.reason || "").trim();
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({error:"Invalid order."});
  if (!reason || reason.length > 500) return res.status(400).json({error:"Enter the inspected return condition and restocking approval, up to 500 characters."});
  try {
    const result = db.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
      if (!order) return {notFound:true};
      if (!["Cancelled","Delivered"].includes(order.status) || !order.shipped_at || !order.stock_deducted)
        throw Object.assign(new Error("Only a shipped or delivered order with previously deducted stock can be approved for restocking."),{statusCode:409});
      if (order.stock_restored) throw Object.assign(new Error("Stock for this order has already been restored."),{statusCode:409});
      const items = groupedOrderItemsForStock(order);
      const getProduct = db.prepare("SELECT id,name FROM products WHERE id=?");
      const adjustStock = db.prepare("UPDATE products SET stock=stock+?,out_of_stock=0 WHERE id=?");
      const recordAdjustment = db.prepare("INSERT INTO order_stock_adjustments(order_id,product_id,product_name,action,quantity,reason,created_at) VALUES(?,?,?,?,?,?,?)");
      const now = serverTimestamp();
      for (const item of items) {
        const product = getProduct.get(item.product_id);
        if (!product) throw Object.assign(new Error(`${item.product_name} no longer exists; stock was not restored.`),{statusCode:409});
        adjustStock.run(item.quantity,item.product_id);
        recordAdjustment.run(id,item.product_id,product.name,"approved_return_restock",item.quantity,reason,now);
      }
      const restoredQuantity = items.reduce((sum,item) => sum + item.quantity,0);
      db.prepare("UPDATE orders SET stock_restored=1,restored_quantity=? WHERE id=?").run(restoredQuantity,id);
      return {restoredQuantity};
    })();
    if (result.notFound) return res.status(404).json({error:"Order not found."});
    res.json({message:"Returned items approved and restocked.",restored_quantity:result.restoredQuantity});
  } catch (error) {
    res.status(error.statusCode || 400).json({error:error.message || "Could not approve returned items for restocking."});
  }
});
app.get("/api/admin/summary", requireAdmin, (req,res) => {
  res.json({
    serverTime:new Date().toISOString(),
    products:db.prepare("SELECT COUNT(*) n FROM products WHERE active=1").get().n,
    orders:db.prepare("SELECT COUNT(*) n FROM orders").get().n,
    revenue:db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status!='Cancelled'").get().n,
    pending:db.prepare("SELECT COUNT(*) n FROM orders WHERE status IN ('New','Confirmed')").get().n
  });
});
app.get("/admin", (req,res) => {
  if(!req.session.adminId || !db.prepare("SELECT 1 FROM admins WHERE id=?").get(req.session.adminId)) return res.redirect(req.session.customerId?"/":"/login");
  res.sendFile(path.join(__dirname,"public","admin.html"));
});
app.get("/login", (req,res) => {
  const resetRequest=passwordResetRequestForBrowser(req);
  if (resetRequest && ["PENDING","APPROVED"].includes(resetRequest.status)
    && req.query["password-reset"]!=="required")
    return res.redirect(302,"/login?password-reset=required");
  res.sendFile(path.join(__dirname,"public","login.html"));
});
app.get("/profile", (req,res) => res.sendFile(path.join(__dirname,"public","login.html")));
app.get("/reset-password",(req,res)=>res.redirect(302,"/login"));
app.get("/categories", (req,res) => res.sendFile(path.join(__dirname,"public","categories.html")));
app.get("/new-collection", (req,res) => res.sendFile(path.join(__dirname,"public","new-collection.html")));
app.get("/about", (req,res) => res.sendFile(path.join(__dirname,"public","about.html")));
app.get("/reviews", (req,res) => res.sendFile(path.join(__dirname,"public","reviews.html")));
app.get("/contact", (req,res) => res.sendFile(path.join(__dirname,"public","contact.html")));
app.get("/products", (req,res) => res.sendFile(path.join(__dirname,"public","products.html")));
app.get("/product", (req,res) => res.sendFile(path.join(__dirname,"public","product.html")));
app.get("/special-offers", (req,res) => res.sendFile(path.join(__dirname,"public","special-offers.html")));
app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, () => {
  console.log(`BS Handlooms running at http://localhost:${PORT}`);
});
