#!/usr/bin/env python3
import re

FILE_PATH = "/Users/muhammadnizaraulia/frappe_docker/development/frappe-bench/apps/ptsv2app/ptsv2app/ptssc/services/sales_order_service.py"

with open(FILE_PATH, "r", encoding="utf-8") as f:
    content = f.read()

new_create = r'''    @timer
    def create(self, sales_order_dto: sales_order_request, payload_oms: dict = None):
        data = sales_order_dto
        try:
            self._validate_create_input(data)

            abbr = cstr(frappe.db.get_value("Company", data["company"], "abbr"))
            data["is_bundling"] = bool(data.get("bundling_combine_items"))

            so_name = self._build_sales_order_name(abbr, data)
            if frappe.db.exists("Sales Order", {"name": so_name}):
                self._log_and_raise(f"Create SO Failed. SO Name {so_name} Is Already Used !")

            if not frappe.db.exists("Warehouse", {"name": data["warehouse"]}):
                self._log_and_raise(f"Warehouse {data['warehouse']} Does not Exist")

            shipping_service = data["shipping_service"]
            self._ensure_shipping_service(shipping_service)
            data["company_shipping_service"] = shipping_service
            self._ensure_company_shipping_service(data["company"], shipping_service)

            # Optional defaults
            data["additional_discount_amount"] = data.get("additional_discount_amount", 0) or 0
            data["additional_discount_percentage"] = data.get("additional_discount_percentage", 0) or 0
            data["shipping_price"] = data.get("shipping_price", 0) or 0

            # Map items from OMS payload if needed
            data["items"] = self._map_items_from_oms(data, payload_oms)
            data["items"] = self.__add_abbr(abbr, data["items"])

            # Compute totals after items are finalized
            data = self.__count_item_amount(data)
            data["total"], data["total_qty"], data["total_weight"] = self.__count_item(data["items"])
            data["grand_total"] = self.__count_grand_total(
                data["total"],
                data["additional_discount_amount"],
                data["additional_discount_percentage"],
                data.get("additional_charges"),
                data["shipping_price"],
            )

            data["workflow_status_history"] = [get_workflow_history_status_format(data["workflow_status"])]
            data["delivery_time"] = datetime.strptime(data["delivery_time"], "%d/%b/%Y %H:%M").strftime("%Y/%m/%d %H:%M:%S")
            data["update_item_counter"] = 0
            data["urgency"] = self.__get_order_urgency(data)
            data["total_qty_complete"] = 0

            if data.get("receiver_phone"):
                data["receiver_phone"] = self.__parse_phone_number(data["receiver_phone"])

            customer = self._prepare_customer(data)
            data["receiver"] = customer.name

            address_entry = self._prepare_address_entry(data, customer.name)
            data["receiver_address"] = address_entry.name
            data["sla"] = datetime.strptime(data["sla"], "%d/%m/%y %H:%M:%S") if data.get("sla") else ""

            data["sales_channel"] = data.get("sales_channel", "")
            data["items"], data["warehouses"], data["qc_outbound"] = self._process_items(data)
            data["order_type_by_picker"] = self.check_order_type(data.get("picker_types", []))
            data["order_type_by_sku"] = "MULTIPLE" if len(data["items"]) > 1 else "SATUAN"
            data["receiver_street_address"] = data["receiver_street_address"].replace("\n", " ")

            shipping_label = bool(data.get("shipping_label"))
            frappe.cache().set_value("payload_so", data)

            result = self.salesOrderRespository.create_sales_order(data)
            return {"result": result, "is_shipping_label_has_value": shipping_label}

        except (frappe.DuplicateEntryError, frappe.ValidationError) as error:
            notification_service.send_to_simpan_error({
                "title": "Create Sales Order Error",
                "link": "",
                "document": data.get("company_order_number", "") if isinstance(data, dict) else "",
                "message": f"<font color=\"#FF0000\">{error}</font>",
            })
            frappe.logger("sales-order-service").error({"method": "create", "error": str(error)})
            frappe.db.rollback()
            raise

'''

helper_methods = r'''    # ------------------------------------------------------------------
    # Create helpers
    # ------------------------------------------------------------------
    def _log_and_raise(self, message: str):
        frappe.logger("sales-order-service").error({"method": "create", "payload": {"message": message}})
        raise frappe.ValidationError(message)

    def _validate_create_input(self, data: sales_order_request):
        if not data.get("company"):
            self._log_and_raise("Create SO Failed. Company is required !")
        if not frappe.db.exists("Company", data["company"]):
            self._log_and_raise(f"Create SO Failed. Company {data['company']} Not Found !")
        if not data.get("company_order_number"):
            self._log_and_raise("Create SO Failed. company_order_number is required !")

    def _build_sales_order_name(self, abbr: str, data: sales_order_request) -> str:
        sales_channel = data.get("sales_channel")
        if sales_channel:
            channel_code = getattr(sales_order_sales_channel, sales_channel, "").value
            return f"{abbr}-{channel_code}-{data['company_order_number']}"
        return f"{abbr}-{data['company_order_number']}"

    def _ensure_shipping_service(self, shipping_service: str):
        if not frappe.db.exists("Shipping Service", shipping_service):
            create_shipping_service({
                "shipping_service_name": shipping_service,
                "shipping_courier": "Others"
            })

    def _ensure_company_shipping_service(self, company: str, shipping_service: str):
        if not frappe.db.exists("Company Shipping Service", {"company_shipping_service": shipping_service, "company": company}):
            companyShippingServiceRepository.create(
                company_shipping_service_model(
                    company=company,
                    company_shipping_service=shipping_service,
                    translated_shipping_service=shipping_service
                )
            )

    def _map_items_from_oms(self, data: sales_order_request, payload_oms: dict) -> list:
        items = list(data.get("items") or [])
        if not payload_oms:
            return items
        if data.get("is_multi_location_order") is True:
            return items
        if len(items) == len(payload_oms.get("items") or []):
            return items

        frappe.logger("sales-order-service").info({"method": "create", "message": "Item count mismatch, remapping with payload OMS"})
        existing_codes = {item["item_code"] for item in items}
        for oms_item in payload_oms["items"]:
            if oms_item["Code"] not in existing_codes:
                items.append(item_service.translasi_item(oms_item))
                existing_codes.add(oms_item["Code"])
        return items

    def _prepare_customer(self, data: sales_order_request):
        receiver_name = re.sub(r"[^A-Za-z0-9\s]", "", data["receiver_name"])
        return create_or_get_customer({
            "company": data["company"],
            "customer_name": receiver_name.rstrip(),
            "phone": data.get("receiver_phone"),
            "email": data.get("receiver_email"),
            "address": ""
        })

    def _prepare_address_entry(self, data: sales_order_request, customer_name: str):
        return create_or_get_address_entry({
            "street_address": data["receiver_street_address"],
            "city_mapping": data.get("city_mapping", ""),
            "zip_code": data["receiver_zip_code"],
            "country": data.get("receiver_country") or "ID",
            "county": data.get("receiver_county", ""),
            "city": data.get("receiver_city") or "NA",
            "state": data.get("receiver_state") or "NA",
            "phone": data.get("receiver_phone", "0"),
            "email": data.get("receiver_email"),
            "owner_type": "Customer",
            "owner_name": customer_name
        })

    def _process_items(self, data: sales_order_request):
        picker_types = []
        warehouses = []
        processed_items = []
        sales_order_items = defaultdict(dict)
        qc_outbound_order = False

        item_codes = [so_item["item_code"] for so_item in data["items"]]
        items_docs = {doc.name: doc for doc in frappe.get_all("Item", filters={"name": ["in", item_codes]}, fields=["name", "is_qc_outbound", "picker_type"])}
        bins = frappe.get_all("Bin", filters={"item_code": ["in", item_codes], "warehouse": data["warehouse"]}, fields=["item_code", "actual_qty", "reserved_qty"])
        bins_by_item = {b["item_code"]: b for b in bins}

        for so_item in data["items"]:
            item_code = so_item["item_code"]
            item = items_docs.get(item_code)
            if not item:
                raise frappe.ValidationError(f"Item {item_code} not found")

            if item.get("is_qc_outbound"):
                qc_outbound_order = True

            bin_doc = bins_by_item.get(item_code)
            if not bin_doc:
                raise frappe.ValidationError(f"Item {item_code} does not have a bin, please inbound first!")

            total_qty = so_item["qty"] + (bin_doc["reserved_qty"] or 0)
            if total_qty > (bin_doc["actual_qty"] or 0):
                data["oversell"] = True

            picker_type_name = item.get("picker_type")
            existing = next((pt for pt in picker_types if pt["name"] == picker_type_name), None)
            if existing:
                existing["qty"] += 1
            elif picker_type_name:
                picker_types.append({"name": picker_type_name, "qty": 1})

            is_bundling = any(item_code.find(bi.get("item_code")) > -1 for bi in data.get("bundling_combine_items", []))

            if data.get("is_multi_location_order"):
                warehouse_doc = frappe.get_doc("Warehouse", {"warehouse_name": so_item["warehouse"], "company": data["company"]})
                warehouses.append({
                    "warehouse": warehouse_doc.name,
                    "warehouse_profile": warehouse_doc.warehouse_profile or ""
                })
                so_item["is_bundling"] = is_bundling
                so_item["warehouse"] = warehouse_doc.name
                processed_items.append(so_item)
            else:
                if item_code in sales_order_items:
                    existing = sales_order_items[item_code]
                    if existing["price"] > 0:
                        continue
                    for k in ["qty", "price", "discount_amount", "amount", "total_amount"]:
                        existing[k] += so_item[k]
                    discount_pct = (existing["price"] - existing["discount_amount"]) / existing["price"] * 100
                    existing["discount_percentage"] = discount_pct
                    existing["is_bundling"] = is_bundling
                else:
                    so_item["is_bundling"] = is_bundling
                    sales_order_items[item_code] = so_item

        data["picker_types"] = picker_types
        final_items = processed_items if processed_items else list(sales_order_items.values())
        return final_items, warehouses, qc_outbound_order

'''

# Pattern to match the entire create method from decorator until def check_order_type
pattern = re.compile(r"(    @timer\n    def create\(self, sales_order_dto: sales_order_request, payload_oms: dict = None\):.*?)(?=\n    def check_order_type)", re.DOTALL)

match = pattern.search(content)
if not match:
    raise RuntimeError("Could not find create method")

old_create = match.group(1)
replacement = new_create + helper_methods
content = content.replace(old_create, replacement)

with open(FILE_PATH, "w", encoding="utf-8") as f:
    f.write(content)

print("Refactor complete")
