/**
 * REYNA ADVANCED TRACKER FOR TRUCKING BUSINESS - ENHANCED VERSION
 * Complete Trucking Management System 
 * Google Apps Script backend  +  Postgres (Supabase) database
 */

// Logical table names used throughout the code.
const SHEETS = {
  DRIVERS: 'Drivers',
  HELPERS: 'Helpers',
  TRUCKS: 'Trucks',
  TRIPS: 'Trips',
  CUSTOMERS: 'Customers',
  EXPENSES: 'Expenses',
  ROUTES: 'Routes',
  PAYMENTS: 'Payments',
  SETTINGS: 'Settings'
};

// [display name used by the dashboard, database column, optional type]
const TABLES_ = {
  Drivers:   { table: 'drivers',   order: 'created_at.asc,driver_id.asc',   cols: [['Driver ID', 'driver_id'], ['Driver Name', 'driver_name'], ['License Number', 'license_number'], ['Contact Number', 'contact_number'], ['Address', 'address'], ['Driver Rate', 'driver_rate'], ['Status', 'status'], ['Date Added', 'date_added']] },
  Helpers:   { table: 'helpers',   order: 'created_at.asc,helper_id.asc',   cols: [['Helper ID', 'helper_id'], ['Helper Name', 'helper_name'], ['Contact Number', 'contact_number'], ['Address', 'address'], ['Default Rate', 'default_rate'], ['Status', 'status'], ['Date Added', 'date_added']] },
  Trucks:    { table: 'trucks',    order: 'created_at.asc,truck_id.asc',    cols: [['Truck ID', 'truck_id'], ['Plate Number', 'plate_number'], ['Model/Type', 'model_type'], ['Status', 'status'], ['Date Added', 'date_added']] },
  Customers: { table: 'customers', order: 'created_at.asc,customer_id.asc', cols: [['Customer ID', 'customer_id'], ['Customer Name', 'customer_name'], ['Company Name', 'company_name'], ['Contact Number', 'contact_number'], ['Email', 'email'], ['Address', 'address'], ['Credit Limit', 'credit_limit'], ['Current Balance', 'current_balance'], ['Payment Terms', 'payment_terms'], ['Status', 'status'], ['Date Added', 'date_added']] },
  Trips:     { table: 'trips',     order: 'created_at.asc,trip_id.asc',     cols: [['Trip ID', 'trip_id'], ['Date', 'trip_date'], ['Driver ID', 'driver_id'], ['Driver Name', 'driver_name'], ['Customer Name', 'customer_name'], ['Origin', 'origin'], ['Destination', 'destination'], ['Distance', 'distance'], ['Cargo Type', 'cargo_type'], ['Weight', 'weight'], ['Trip Rate', 'trip_rate'], ['Fuel Cost', 'fuel_cost'], ['Toll Fee', 'toll_fee'], ['Meal Allowance', 'meal_allowance'], ['Other Expenses', 'other_expenses'], ['Total Expenses', 'total_expenses'], ['Gross Income', 'gross_income'], ['Net Profit', 'net_profit'], ['Payment Status', 'payment_status'], ['Trip Status', 'trip_status'], ['Notes', 'notes'], ['Trucks Data', 'trucks_data'], ['Helpers Data', 'helpers_data', 'json'], ['Driver Pay', 'driver_pay'], ['Customer Subsidy', 'customer_subsidy'], ['VAT Status', 'vat_status']] },
  Expenses:  { table: 'expenses',  order: 'created_at.asc,expense_id.asc',  cols: [['Expense ID', 'expense_id'], ['Date', 'expense_date'], ['Category', 'category'], ['Description', 'description'], ['Amount', 'amount'], ['Paid By', 'paid_by'], ['Payment Method', 'payment_method'], ['Receipt Number', 'receipt_number'], ['Notes', 'notes']] },
  Payments:  { table: 'payments',  order: 'created_at.asc,payment_id.asc',  cols: [['Payment ID', 'payment_id'], ['Customer ID', 'customer_id'], ['Customer Name', 'customer_name'], ['Payment Date', 'payment_date'], ['Amount', 'amount'], ['Payment Method', 'payment_method'], ['Reference Number', 'reference_number'], ['Notes', 'notes'], ['Timestamp', 'created_at']] },
  Routes:    { table: 'routes',    order: 'created_at.asc,route_id.asc',    cols: [['Route ID', 'route_id'], ['Origin', 'origin'], ['Destination', 'destination'], ['Distance', 'distance'], ['Base Rate', 'base_rate'], ['Fuel Cost Estimate', 'fuel_cost_estimate'], ['Toll Fee', 'toll_fee'], ['Estimated Time', 'estimated_time']] },
  Settings:  { table: 'settings',  order: 'setting_name.asc',               cols: [['Setting Name', 'setting_name'], ['Value', 'value']] }
};

const PAGE_SIZE_ = 1000;

function toLegacy_(cfg, row) {
  const o = {};
  cfg.cols.forEach(function (c) {
    let v = row[c[1]];
    if (c[2] === 'json') v = (v === null || v === undefined) ? '' : (typeof v === 'string' ? v : JSON.stringify(v));
    else if (v === null || v === undefined) v = '';
    else if (typeof v === 'string') v = v.trim();
    o[c[0]] = v;
  });
  return o;
}

function tableQuery_(cfg, offset, filter) {
  return cfg.table + '?select=*&order=' + cfg.order + (filter ? '&' + filter : '') + '&limit=' + PAGE_SIZE_ + '&offset=' + offset;
}

/** All rows of a table (paged, 1000 at a time), starting at startOffset. */
function fetchRaw_(cfg, startOffset, filter) {
  let all = [];
  let offset = startOffset;
  while (true) {
    const rows = dbRequest_('get', tableQuery_(cfg, offset, filter)) || [];
    all = all.concat(rows);
    if (rows.length < PAGE_SIZE_) break;
    offset += PAGE_SIZE_;
  }
  return all;
}

/** Rows of one table, optionally filtered (a PostgREST filter such as "trip_id=eq.TRP00001"). */
function getTableData_(name, filter) {
  const cfg = TABLES_[name];
  if (!cfg) return [];
  return fetchRaw_(cfg, 0, filter).map(function (r) { return toLegacy_(cfg, r); });
}

/** Loads several tables at the same time (one round trip instead of one per table). */
function loadTables_(names) {
  const c = dbConfig_();
  const headers = { apikey: c.key, Authorization: 'Bearer ' + c.key };
  const requests = names.map(function (n) {
    return { url: c.url + '/rest/v1/' + tableQuery_(TABLES_[n], 0, ''), method: 'get', headers: headers, muteHttpExceptions: true };
  });
  const responses = UrlFetchApp.fetchAll(requests);
  const out = {};
  responses.forEach(function (res, i) {
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) throw new Error('Database error ' + code + ': ' + String(res.getContentText()).slice(0, 200));
    const cfg = TABLES_[names[i]];
    let rows = JSON.parse(res.getContentText() || '[]');
    if (rows.length >= PAGE_SIZE_) rows = rows.concat(fetchRaw_(cfg, PAGE_SIZE_, ''));
    out[names[i]] = rows.map(function (r) { return toLegacy_(cfg, r); });
  });
  return out;
}

function dbInsert_(table, obj) {
  const rows = dbRequest_('post', table, obj, { Prefer: 'return=representation' });
  return rows && rows[0];
}
function dbUpdate_(table, filter, obj) {
  return dbRequest_('patch', table + '?' + filter, obj, { Prefer: 'return=representation' }) || [];
}
function eq_(v) { return 'eq.' + encodeURIComponent(String(v)); }

function num_(v) {
  const n = parseFloat(String(v === undefined || v === null ? '' : v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}
function txt_(v) { return (v === undefined || v === null) ? '' : String(v).trim(); }
function todayStr_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function dateStr_(v) {
  const s = txt_(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = s ? new Date(s) : null;
  return (d && !isNaN(d.getTime())) ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') : todayStr_();
}
function dbFriendlyError_(err, what) {
  const m = String(err);
  if (/duplicate key|Database error 409/.test(m) && !/foreign key/.test(m)) return what + ' already exists.';
  if (/foreign key/.test(m)) return 'A selected record no longer exists. Refresh the page and try again.';
  return m;
}

function settingsFromRows_(rows) {
  const settings = {};
  rows.forEach(function (row) {
    if (row['Setting Name'] && row['Value'] !== undefined && row['Value'] !== '') settings[row['Setting Name']] = row['Value'];
  });
  return settings;
}

function getSettingsData_() {
  try { return settingsFromRows_(getTableData_(SHEETS.SETTINGS)); } catch (error) { return {}; }
}

function getDashboardData_(filterType, customStartDate, customEndDate) {
  try {
    const dateRange = getDateRange_(filterType, customStartDate, customEndDate);
    const t = loadTables_([SHEETS.DRIVERS, SHEETS.HELPERS, SHEETS.TRUCKS, SHEETS.TRIPS, SHEETS.CUSTOMERS,
                           SHEETS.EXPENSES, SHEETS.ROUTES, SHEETS.PAYMENTS, SHEETS.SETTINGS]);
    const result = {
      drivers: t.Drivers,
      helpers: t.Helpers,
      trucks: t.Trucks,
      trips: t.Trips.reverse(),
      customers: t.Customers,
      expenses: t.Expenses.reverse(),
      routes: t.Routes,
      payments: t.Payments.reverse(),
      settings: settingsFromRows_(t.Settings),
      dateRange: dateRange
    };
    result.analytics = calculateAnalytics_(result, dateRange);
    return JSON.parse(JSON.stringify(result));
  } catch (error) {
    return JSON.parse(JSON.stringify({ error: error.toString() }));
  }
}

function getDateRange_(filterType, customStartDate, customEndDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let startDate, endDate;
  
  switch(filterType) {
    case 'today':
      startDate = new Date(today); endDate = new Date(today); endDate.setHours(23, 59, 59, 999); break;
    case 'yesterday':
      startDate = new Date(today); startDate.setDate(startDate.getDate() - 1); endDate = new Date(startDate); endDate.setHours(23, 59, 59, 999); break;
    case 'lastWeek':
      startDate = new Date(today); startDate.setDate(startDate.getDate() - 7); endDate = new Date(today); endDate.setHours(23, 59, 59, 999); break;
    case 'month':
      startDate = new Date(today.getFullYear(), today.getMonth(), 1); endDate = new Date(today); endDate.setHours(23, 59, 59, 999); break;
    case 'year':
      startDate = new Date(today.getFullYear(), 0, 1); endDate = new Date(today); endDate.setHours(23, 59, 59, 999); break;
    case 'custom':
      startDate = new Date(customStartDate); endDate = new Date(customEndDate); endDate.setHours(23, 59, 59, 999); break;
    default:
      startDate = new Date(today.getFullYear(), today.getMonth(), 1); endDate = new Date(today); endDate.setHours(23, 59, 59, 999);
  }
  return { startDate: startDate.toISOString(), endDate: endDate.toISOString(), filterType: filterType };
}

function parseDate_(dateValue) {
  if (!dateValue) return null;
  if (dateValue instanceof Date) return dateValue;
  if (typeof dateValue === 'string') {
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
    if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]), 12, 0, 0);
    const parsed = new Date(dateValue);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  if (typeof dateValue === 'number') {
    const excelEpoch = new Date(1900, 0, 1);
    return new Date(excelEpoch.getTime() + (dateValue - 2) * 24 * 60 * 60 * 1000);
  }
  return null;
}

function addTruck_(truckData) {
  try {
    const plate = txt_(truckData && truckData.plate);
    if (!plate) return { success: false, error: 'Plate number is required.' };
    const row = dbInsert_('trucks', { plate_number: plate, model_type: txt_(truckData.model) });
    return { success: true, truckId: row.truck_id };
  } catch (error) { return { success: false, error: dbFriendlyError_(error, 'That plate number') }; }
}

function addHelper_(helperData) {
  try {
    const name = txt_(helperData && helperData.name);
    if (!name) return { success: false, error: 'Helper name is required.' };
    const row = dbInsert_('helpers', { helper_name: name, contact_number: txt_(helperData.contact), address: txt_(helperData.address), default_rate: num_(helperData.rate) });
    return { success: true, helperId: row.helper_id };
  } catch (error) { return { success: false, error: dbFriendlyError_(error, 'That helper') }; }
}

function addDriver_(driverData) {
  try {
    const name = txt_(driverData && driverData.driverName);
    if (!name) return { success: false, error: 'Driver name is required.' };
    const row = dbInsert_('drivers', { driver_name: name, license_number: txt_(driverData.licenseNumber), contact_number: txt_(driverData.contactNumber),
      address: txt_(driverData.address), driver_rate: num_(driverData.driverRate) });
    return { success: true, driverId: row.driver_id };
  } catch (error) { return { success: false, error: dbFriendlyError_(error, 'That driver') }; }
}

function addCustomer_(customerData) {
  try {
    const name = txt_(customerData && customerData.customerName);
    if (!name) return { success: false, error: 'Customer name is required.' };
    const row = dbInsert_('customers', { customer_name: name, company_name: txt_(customerData.companyName), contact_number: txt_(customerData.contactNumber),
      email: txt_(customerData.email), address: txt_(customerData.address), credit_limit: num_(customerData.creditLimit),
      payment_terms: txt_(customerData.paymentTerms) || 'COD' });
    return { success: true, customerId: row.customer_id };
  } catch (error) { return { success: false, error: dbFriendlyError_(error, 'A customer with that name') }; }
}

function addExpense_(expenseData) {
  try {
    const d = expenseData || {};
    const row = dbInsert_('expenses', { expense_date: dateStr_(d.date), category: txt_(d.category), description: txt_(d.description), amount: Math.abs(num_(d.amount)),
      paid_by: txt_(d.paidBy), payment_method: txt_(d.paymentMethod) || 'Cash', receipt_number: txt_(d.receiptNumber), notes: txt_(d.notes) });
    return { success: true, expenseId: row.expense_id };
  } catch (error) { return { success: false, error: dbFriendlyError_(error, 'This expense') }; }
}

function addPayment_(paymentData) {
  try {
    const d = paymentData || {};
    if (!txt_(d.customerId)) return { success: false, error: 'Select a customer.' };
    const row = dbInsert_('payments', { customer_id: txt_(d.customerId), customer_name: txt_(d.customerName), payment_date: dateStr_(d.paymentDate),
      amount: Math.abs(num_(d.amount)), payment_method: txt_(d.paymentMethod) || 'Cash', reference_number: txt_(d.referenceNumber), notes: txt_(d.notes) });
    return { success: true, paymentId: row.payment_id };
  } catch (error) { return { success: false, error: dbFriendlyError_(error, 'This payment') }; }
}

// Field name sent by the dashboard -> database column of the trips table.
const TRIP_DB_ = {
  date: 'trip_date', driverId: 'driver_id', driverName: 'driver_name', customerName: 'customer_name', origin: 'origin', destination: 'destination',
  distance: 'distance', cargoType: 'cargo_type', weight: 'weight', tripRate: 'trip_rate', fuelCost: 'fuel_cost', tollFee: 'toll_fee',
  mealAllowance: 'meal_allowance', otherExpenses: 'other_expenses', totalExpenses: 'total_expenses', grossIncome: 'gross_income', netProfit: 'net_profit',
  paymentStatus: 'payment_status', tripStatus: 'trip_status', notes: 'notes', trucksData: 'trucks_data', helpersData: 'helpers_data',
  driverPay: 'driver_pay', customerSubsidy: 'customer_subsidy', vatStatus: 'vat_status'
};
const TRIP_NUMERIC_ = { distance: 1, weight: 1, tripRate: 1, fuelCost: 1, tollFee: 1, mealAllowance: 1, otherExpenses: 1, totalExpenses: 1,
  grossIncome: 1, netProfit: 1, driverPay: 1, customerSubsidy: 1 };

/** Cleans a trip from the dashboard into database columns. With onlyProvided, fields that were not sent are left out. */
function tripToDb_(t, onlyProvided) {
  const out = {};
  Object.keys(TRIP_DB_).forEach(function (key) {
    if (onlyProvided && t[key] === undefined) return;
    let v = t[key];
    if (key === 'date') v = dateStr_(v);
    else if (TRIP_NUMERIC_[key]) v = num_(v);
    else if (key === 'helpersData') {
      try { v = (typeof v === 'string') ? JSON.parse(v || '[]') : (v || []); } catch (e) { v = []; }
      if (!Array.isArray(v)) v = [];
    }
    else if (key === 'driverId') v = txt_(v) || null;
    else v = txt_(v);
    out[TRIP_DB_[key]] = v;
  });
  return out;
}

function normalizeTrip_(t) {
  const n = function (v) { return parseFloat(String(v === undefined || v === null ? 0 : v).replace(/[^0-9.-]/g, '')) || 0; };
  const hasCosts = t.fuelCost !== undefined || t.driverPay !== undefined;
  let helperPay = 0;
  try { JSON.parse(t.helpersData || '[]').forEach(function (h) { helperPay += n(h.pay); }); } catch (e) {}
  if (hasCosts && (t.totalExpenses === undefined || t.totalExpenses === '')) {
    t.totalExpenses = n(t.fuelCost) + n(t.tollFee) + n(t.mealAllowance) + n(t.otherExpenses) + n(t.driverPay) + helperPay;
  }
  if (hasCosts && (t.netProfit === undefined || t.netProfit === '')) {
    t.netProfit = n(t.grossIncome) - n(t.totalExpenses);
  }
  return t;
}

function addTrip_(tripData) {
  try {
    const t = normalizeTrip_(tripData || {});
    const unavailable = findUnavailableResources_(t);
    if (unavailable.length) {
      return { success: false, error: 'Cannot create the trip. Not available: ' + unavailable.join(', ') + '. Change their status or pick someone else.' };
    }
    if (!t.paymentStatus) t.paymentStatus = 'Unpaid';
    if (!t.tripStatus) t.tripStatus = 'Completed';
    const row = dbInsert_('trips', tripToDb_(t, false));   // the database assigns the next Trip ID
    return { success: true, tripId: row.trip_id };
  } catch (error) {
    return { success: false, error: dbFriendlyError_(error, 'This trip') };
  }
}

function calculateTripPricing_(origin, destination, distance, weight) {
  try {
    const settings = getSettingsData_();
    const routes = getTableData_(SHEETS.ROUTES);
    const matchingRoute = routes.find(r => r['Origin'] === origin && r['Destination'] === destination);
    
    let baseRate = parseFloat(settings['Base Rate per km'] || 50) * parseFloat(distance || 0);
    let fuelCost = 0; let tollFee = 0;
    
    if (matchingRoute) {
      baseRate = parseFloat(String(matchingRoute['Base Rate']).replace(/[^0-9.-]/g, '')) || baseRate;
      fuelCost = parseFloat(String(matchingRoute['Fuel Cost Estimate']).replace(/[^0-9.-]/g, '')) || 0;
      tollFee = parseFloat(String(matchingRoute['Toll Fee']).replace(/[^0-9.-]/g, '')) || 0;
    } else {
      const fuelPrice = parseFloat(settings['Fuel Price per Liter'] || 60);
      const fuelConsumption = parseFloat(settings['Average Fuel Consumption (km/L)'] || 10);
      fuelCost = (parseFloat(distance || 0) / fuelConsumption) * fuelPrice;
    }
    
    const weightAdjustment = baseRate * ((parseFloat(weight || 0) / 1000) * 0.1);
    const totalRate = baseRate + weightAdjustment;
    const estimatedExpenses = fuelCost + tollFee + 500;
    const suggestedPrice = totalRate + estimatedExpenses + (totalRate * 0.2);
    
    return { baseRate: totalRate.toFixed(2), fuelCost: fuelCost.toFixed(2), tollFee: tollFee.toFixed(2), mealAllowance: 500, estimatedExpenses: estimatedExpenses.toFixed(2), suggestedPrice: suggestedPrice.toFixed(2), estimatedProfit: (suggestedPrice - estimatedExpenses).toFixed(2) };
  } catch (error) { return { baseRate: '0.00', fuelCost: '0.00', tollFee: '0.00', mealAllowance: 500, estimatedExpenses: '0.00', suggestedPrice: '0.00', estimatedProfit: '0.00' }; }
}

function generatePayrollInvoice_(employeeName, role, periodStart, periodEnd) {
  try {
    const trips = getTableData_(SHEETS.TRIPS);
    const settings = getSettingsData_();
    const isHelper = (role === 'helper');
    let grossEarnings = 0;
    
    const periodTrips = trips.filter(trip => {
      const tripDate = parseDate_(trip['Date']);
      if (!tripDate) return false;
      const start = new Date(periodStart); const end = new Date(periodEnd);
      end.setHours(23, 59, 59, 999);
      if (tripDate < start || tripDate > end) return false;
      
      if (isHelper) {
        try {
          const helpers = JSON.parse(trip['Helpers Data'] || '[]');
          const helper = helpers.find(h => h.name === employeeName);
          if (helper) { trip._tempPay = parseFloat(helper.pay || 0); return true; }
        } catch(e) {}
        return false;
      } else {
        if (trip['Driver Name'] === employeeName) { trip._tempPay = parseFloat(trip['Driver Pay'] || 0); return true; }
        return false;
      }
    });
    
    periodTrips.forEach(trip => { grossEarnings += trip._tempPay || 0; });
    const mockDriver = { 'Driver Name': employeeName + (isHelper ? ' (Staff)' : ''), 'License Number': isHelper ? 'N/A' : 'See Records' };
    
    return { success: true, html: generatePayrollInvoiceHTML_(mockDriver, periodTrips, periodStart, periodEnd, grossEarnings, settings) };
  } catch (error) { return { success: false, error: error.toString() }; }
}

function generatePayrollInvoiceHTML_(driver, trips, periodStart, periodEnd, grossEarnings, settings) {
  const companyName = settings['Company Name'] || 'Reyna Trucking Business';
  const companyAddress = settings['Company Address'] || '';
  let tripsHtml = '';
  
  trips.forEach(trip => {
    tripsHtml += `<tr>
        <td style="color: #1565c0; border-bottom: 1px solid #eee; padding: 10px;">${parseDate_(trip['Date']).toLocaleDateString('en-PH')}</td>
        <td style="color: #1565c0; border-bottom: 1px solid #eee; padding: 10px;">${trip['Origin']} → ${trip['Destination']}</td>
        <td style="color: #1565c0; font-weight: 600; border-bottom: 1px solid #eee; padding: 10px;">₱${(trip._tempPay || 0).toLocaleString('en-PH', {minimumFractionDigits: 2})}</td>
      </tr>`;
  });
  
  return `
    <div style="font-family: Arial; padding: 20px;">
      <h2 style="text-align: center; color: #1565c0; border-bottom: 2px solid #1565c0; padding-bottom: 10px;">${companyName}</h2>
      <h3 style="text-align: center; color: #1565c0;">PAYROLL SUMMARY</h3>
      <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Employee:</strong> ${driver['Driver Name']}</p>
        <p><strong>Period:</strong> ${new Date(periodStart).toLocaleDateString('en-PH')} - ${new Date(periodEnd).toLocaleDateString('en-PH')}</p>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <tr style="background: #1565c0; color: white;">
          <th style="padding: 10px; text-align:left;">Date</th><th style="padding: 10px; text-align:left;">Route</th><th style="padding: 10px; text-align:left;">Pay</th>
        </tr>
        ${tripsHtml}
      </table>
      <div style="text-align: right; font-size: 20px; font-weight: bold; color: #1565c0; padding: 15px; background: #e3f2fd; border-radius: 8px;">
        TOTAL EARNINGS: ₱${parseFloat(grossEarnings).toLocaleString('en-PH', {minimumFractionDigits: 2})}
      </div>
    </div>`;
}

function getTripInvoice_(tripId) {
  try {
    const trip = getTableData_(SHEETS.TRIPS, 'trip_id=' + eq_(tripId))[0];
    if (!trip) return { success: false, error: 'Trip not found' };
    const settings = getSettingsData_();
    // Safely grab customer or fallback to empty object if not found
    const customer = getTableData_(SHEETS.CUSTOMERS, 'customer_name=' + eq_(trip['Customer Name']))[0] || {};
    
    const payload = { 
      success: true, 
      trip: trip, 
      customer: customer, 
      settings: settings 
    };

    // FIX: This safely sanitizes Google Date objects so they don't return 'null' to the frontend
    return JSON.parse(JSON.stringify(payload));
    
  } catch (error) { 
    return { success: false, error: error.toString() }; 
  }
}

// -----------------------------------------------------
// NEW ACCOUNTING SAFE ANALYTICS
// -----------------------------------------------------
function calculateAnalytics_(data, dateRange) {
  try {
    const trips = data.trips || [];
    const expenses = data.expenses || [];
    const customers = data.customers || [];
    const payments = data.payments || [];
    
    const startDateObj = new Date(dateRange.startDate);
    const endDateObj = new Date(dateRange.endDate);
    
    const filteredTrips = trips.filter(trip => { try { const d = parseDate_(trip['Date']); return d && d >= startDateObj && d <= endDateObj; } catch(e) { return false; } });
    const filteredExpenses = expenses.filter(exp => { try { const d = parseDate_(exp['Date']); return d && d >= startDateObj && d <= endDateObj; } catch(e) { return false; } });
    const filteredPayments = payments.filter(p => { try { const d = parseDate_(p['Payment Date']); return d && d >= startDateObj && d <= endDateObj; } catch(e) { return false; } });
    
    // Revenue = Total Billed to Client (Rate + Subsidy)
    const totalRevenue = filteredTrips.reduce((sum, trip) => sum + (parseFloat(String(trip['Gross Income']).replace(/[^0-9.-]/g, '')) || 0), 0);
    
    // Direct Costs / Cost of Services (Fuel, Tolls, Meals, Driver Pay, Helper Pay per trip)
    const costOfServices = filteredTrips.reduce((sum, trip) => sum + (parseFloat(String(trip['Total Expenses']).replace(/[^0-9.-]/g, '')) || 0), 0);
    
    // Gross Profit = Revenue - Cost of Services
    const grossProfit = totalRevenue - costOfServices;
    
    // Operating Expenses = General Office/Maintenance Overhead (From the Expenses Tab)
    const operatingExpenses = filteredExpenses.reduce((sum, exp) => sum + (parseFloat(String(exp['Amount']).replace(/[^0-9.-]/g, '')) || 0), 0);
    
    // Net Profit = Gross Profit - Operating Expenses
    const totalNetProfit = grossProfit - operatingExpenses;
    
    const totalTrips = filteredTrips.length;
    const totalPaymentsReceived = filteredPayments.reduce((sum, p) => sum + (parseFloat(String(p['Amount']).replace(/[^0-9.-]/g, '')) || 0), 0);
    
    const accountReceivables = calculateAccountReceivables_(customers, trips, payments);
    
    return {
      totalRevenue, costOfServices, grossProfit, operatingExpenses, totalNetProfit, totalTrips, totalPaymentsReceived,
      grossMargin: totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(2) : 0,
      profitMargin: totalRevenue > 0 ? ((totalNetProfit / totalRevenue) * 100).toFixed(2) : 0,
      expenseBreakdown: calculateExpenseBreakdown_(filteredExpenses),
      monthlyTrends: calculateTrends_(trips, expenses, dateRange.filterType),
      topRoutes: calculateTopRoutes_(filteredTrips),
      driverPerformance: calculateDriverPerformance_(filteredTrips),
      accountReceivables,
      topCreditors: accountReceivables.filter(ar => ar.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 10),
      totalReceivables: accountReceivables.reduce((sum, ar) => sum + ar.balance, 0),
      avgRevenuePerTrip: totalTrips > 0 ? (totalRevenue / totalTrips).toFixed(2) : 0
    };
  } catch (error) { return {}; }
}

function calculateAccountReceivables_(customers, trips, payments) {
  const receivables = [];
  customers.forEach(customer => {
    const customerId = customer['Customer ID'];
    const customerName = customer['Customer Name'];
    const customerTrips = trips.filter(trip => trip['Customer Name'] === customerName);
    const totalBilled = customerTrips.reduce((sum, trip) => sum + (parseFloat(String(trip['Gross Income']).replace(/[^0-9.-]/g, '')) || 0), 0);
    const customerPayments = payments.filter(payment => payment['Customer ID'] === customerId);
    const totalPaid = customerPayments.reduce((sum, payment) => sum + (parseFloat(String(payment['Amount']).replace(/[^0-9.-]/g, '')) || 0), 0);
    const balance = totalBilled - totalPaid;
    if (totalBilled > 0 || balance !== 0) {
      receivables.push({ customerId, customerName, totalBilled, totalPaid, balance, creditLimit: parseFloat(String(customer['Credit Limit']).replace(/[^0-9.-]/g, '')) || 0, paymentTerms: customer['Payment Terms'] || 'COD' });
    }
  });
  return receivables;
}

function calculateExpenseBreakdown_(expenses) {
  const breakdown = {};
  expenses.forEach(exp => {
    const category = exp['Category'] || 'Other';
    const amount = parseFloat(String(exp['Amount']).replace(/[^0-9.-]/g, '')) || 0;
    breakdown[category] = (breakdown[category] || 0) + amount;
  });
  return breakdown;
}

function calculateTrends_(trips, expenses, filterType) {
  const trends = []; const today = new Date(); let periods = 6; let periodType = 'month';
  switch(filterType) {
    case 'today': case 'yesterday': periods = 7; periodType = 'day'; break;
    case 'lastWeek': periods = 4; periodType = 'week'; break;
    case 'year': periods = 12; periodType = 'month'; break;
    default: periods = 6; periodType = 'month';
  }
  for (let i = periods - 1; i >= 0; i--) {
    let targetDate, periodStart, periodEnd, label;
    if (periodType === 'day') {
      targetDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      periodStart = new Date(targetDate); periodEnd = new Date(targetDate); periodEnd.setHours(23, 59, 59, 999);
      label = targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } else if (periodType === 'week') {
      targetDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (i * 7));
      periodStart = new Date(targetDate); periodEnd = new Date(targetDate); periodEnd.setDate(periodEnd.getDate() + 6);
      label = `Week ${periods - i}`;
    } else {
      targetDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
      periodStart = new Date(targetDate); periodEnd = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
      label = targetDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
    const periodTrips = trips.filter(trip => { try { const d = parseDate_(trip['Date']); return d && d >= periodStart && d <= periodEnd; } catch (e) { return false; } });
    const periodExpenses = expenses.filter(exp => { try { const d = parseDate_(exp['Date']); return d && d >= periodStart && d <= periodEnd; } catch (e) { return false; } });
    
    const revenue = periodTrips.reduce((sum, trip) => sum + (parseFloat(String(trip['Gross Income']).replace(/[^0-9.-]/g, '')) || 0), 0);
    const expenseTotal = periodExpenses.reduce((sum, exp) => sum + (parseFloat(String(exp['Amount']).replace(/[^0-9.-]/g, '')) || 0), 0);
    
    trends.push({ period: label, revenue, expenses: expenseTotal, profit: revenue - expenseTotal, trips: periodTrips.length });
  }
  return trends;
}

function calculateTopRoutes_(trips) {
  const routes = {};
  trips.forEach(trip => {
    const route = `${trip['Origin']} → ${trip['Destination']}`;
    if (!routes[route]) routes[route] = { route, count: 0, revenue: 0 };
    routes[route].count++;
    routes[route].revenue += parseFloat(String(trip['Gross Income']).replace(/[^0-9.-]/g, '')) || 0;
  });
  return Object.values(routes).sort((a, b) => b.count - a.count).slice(0, 5);
}

function calculateDriverPerformance_(trips) {
  const drivers = {};
  trips.forEach(trip => {
    const driverName = trip['Driver Name'];
    if (!drivers[driverName]) drivers[driverName] = { name: driverName, trips: 0, revenue: 0, profit: 0 };
    drivers[driverName].trips++;
    drivers[driverName].revenue += parseFloat(String(trip['Gross Income']).replace(/[^0-9.-]/g, '')) || 0;
    drivers[driverName].profit += parseFloat(String(trip['Net Profit']).replace(/[^0-9.-]/g, '')) || 0;
  });
  return Object.values(drivers).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
}

function getCustomerStatement_(customerId) {
  try {
    const customer = getTableData_(SHEETS.CUSTOMERS, 'customer_id=' + eq_(customerId))[0];
    if (!customer) return { success: false, error: 'Customer not found' };
    const customerTrips = getTableData_(SHEETS.TRIPS, 'customer_name=' + eq_(customer['Customer Name']));
    const customerPayments = getTableData_(SHEETS.PAYMENTS, 'customer_id=' + eq_(customerId));
    
    const transactions = [];
    customerTrips.forEach(trip => { const d = parseDate_(trip['Date']); if(d) transactions.push({ date: d, type: 'Invoice', reference: trip['Trip ID'], description: `${trip['Origin']} → ${trip['Destination']}`, debit: parseFloat(String(trip['Gross Income']).replace(/[^0-9.-]/g, '')) || 0, credit: 0 }); });
    customerPayments.forEach(payment => { const d = parseDate_(payment['Payment Date']); if(d) transactions.push({ date: d, type: 'Payment', reference: payment['Payment ID'], description: payment['Notes'] || 'Payment received', debit: 0, credit: parseFloat(String(payment['Amount']).replace(/[^0-9.-]/g, '')) || 0 }); });
    transactions.sort((a, b) => a.date - b.date);
    let balance = 0; transactions.forEach(trans => { balance += trans.debit - trans.credit; trans.balance = balance; });
    return { success: true, customer, transactions, currentBalance: balance };
  } catch (error) { return { success: false, error: error.toString() }; }
}

function generateReports_(filterType, customStartDate, customEndDate) {
  try {
    const data = getDashboardData_(filterType, customStartDate, customEndDate);
    if (!data || data.error) return { success: false, error: data.error || 'Failed to load data' };
    return { success: true, reports: { incomeStatement: generateIncomeStatement_(data), trialBalance: generateTrialBalance_(data), profitAndLoss: generateProfitAndLoss_(data), expensesReport: generateExpensesReport_(data), customerReport: generateCustomerReport_(data), driversReport: generateDriversReport_(data), accountsReceivable: generateAccountsReceivableReport_(data), paymentsReport: generatePaymentsReport_(data), dateRange: data.dateRange } };
  } catch (error) { return { success: false, error: error.toString() }; }
}

function generateProfitAndLoss_(data) {
  const analytics = data.analytics;
  return {
    companyName: data.settings['Company Name'] || 'Reyna Trucking Business', reportTitle: 'PROFIT AND LOSS STATEMENT', periodStart: formatDate_(data.dateRange.startDate), periodEnd: formatDate_(data.dateRange.endDate),
    sections: [
      { title: 'REVENUE', items: [ { label: 'Total Freight Revenue (Inc. Subsidies)', amount: analytics.totalRevenue } ], total: { label: 'Total Revenue', amount: analytics.totalRevenue } },
      { title: 'COST OF SERVICES', items: [ { label: 'Direct Trip Costs (Fuel, Tolls, Driver & Helper Pay)', amount: analytics.costOfServices } ], total: { label: 'Total Cost of Services', amount: analytics.costOfServices } },
      { title: 'GROSS PROFIT', items: [], total: { label: 'Gross Profit', amount: analytics.grossProfit, isBold: true } },
      { title: 'OPERATING EXPENSES', items: Object.entries(analytics.expenseBreakdown).map(([category, amount]) => ({ label: category, amount: amount })), total: { label: 'Total Operating Expenses', amount: analytics.operatingExpenses } },
      { title: 'NET INCOME', items: [ { label: 'Gross Profit', amount: analytics.grossProfit }, { label: 'Less: Operating Expenses', amount: analytics.operatingExpenses, isNegative: true } ], total: { label: 'Net Income', amount: analytics.totalNetProfit, isGrandTotal: true, percentage: analytics.totalRevenue > 0 ? ((analytics.totalNetProfit / analytics.totalRevenue) * 100).toFixed(2) + '% of Revenue' : '0%' } }
    ],
    summary: { totalRevenue: analytics.totalRevenue, costOfServices: analytics.costOfServices, grossProfit: analytics.grossProfit, grossProfitMargin: analytics.grossMargin, operatingExpenses: analytics.operatingExpenses, netIncome: analytics.totalNetProfit, netProfitMargin: analytics.profitMargin }
  };
}

function generateIncomeStatement_(data) {
  const analytics = data.analytics;
  return {
    companyName: data.settings['Company Name'] || 'Reyna Trucking Business', reportTitle: 'INCOME STATEMENT',
    sections: [
      { title: 'REVENUE', items: [ { label: 'Gross Income', amount: analytics.totalRevenue } ], total: { label: 'Total Revenue', amount: analytics.totalRevenue } },
      { title: 'EXPENSES', items: [ { label: 'Direct Trip Costs', amount: analytics.costOfServices }, { label: 'Operating Expenses', amount: analytics.operatingExpenses } ], total: { label: 'Total Expenses', amount: analytics.costOfServices + analytics.operatingExpenses } },
      { title: 'NET INCOME', items: [], total: { label: 'Net Income', amount: analytics.totalNetProfit, isGrandTotal: true } }
    ]
  };
}

function generateTrialBalance_(data) {
  const analytics = data.analytics;
  const accounts = [
    { account: 'ASSETS', debit: 0, credit: 0, isHeader: true },
    { account: 'Accounts Receivable', debit: analytics.totalReceivables, credit: 0 },
    { account: 'Cash', debit: analytics.totalPaymentsReceived, credit: 0 },
    { account: 'EQUITY', debit: 0, credit: 0, isHeader: true },
    { account: 'Retained Earnings', debit: 0, credit: analytics.totalNetProfit },
    { account: 'REVENUE', debit: 0, credit: 0, isHeader: true },
    { account: 'Freight Revenue', debit: 0, credit: analytics.totalRevenue },
    { account: 'EXPENSES', debit: 0, credit: 0, isHeader: true },
    { account: 'Direct Trip Costs (COGS)', debit: analytics.costOfServices, credit: 0 },
    { account: 'Operating Expenses', debit: analytics.operatingExpenses, credit: 0 }
  ];
  return { companyName: data.settings['Company Name'] || 'Reyna', reportTitle: 'TRIAL BALANCE', accounts: accounts, totalDebit: accounts.reduce((sum, acc) => sum + (acc.debit || 0), 0), totalCredit: accounts.reduce((sum, acc) => sum + (acc.credit || 0), 0) };
}

function formatDate_(dateValue) {
  if (!dateValue) return '-';
  try { return new Date(dateValue).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return dateValue; }
}

function generateExpensesReport_(data) {
  const startDate = new Date(data.dateRange.startDate); const endDate = new Date(data.dateRange.endDate);
  const filteredExpenses = data.expenses.filter(exp => { const d = parseDate_(exp['Date']); return d && d >= startDate && d <= endDate; });
  return { companyName: data.settings['Company Name'] || 'Reyna', reportTitle: 'EXPENSES REPORT', expenses: filteredExpenses.map(exp => ({ date: exp['Date'], expenseId: exp['Expense ID'], category: exp['Category'], description: exp['Description'], amount: parseFloat(String(exp['Amount']).replace(/[^0-9.-]/g, '')) || 0, paidBy: exp['Paid By'], paymentMethod: exp['Payment Method'] })), summary: data.analytics.expenseBreakdown, totalExpenses: data.analytics.operatingExpenses };
}

function generateCustomerReport_(data) {
  const customerDetails = data.customers.map(customer => {
    const customerTrips = data.trips.filter(t => t['Customer Name'] === customer['Customer Name']);
    const customerPayments = data.payments.filter(p => p['Customer ID'] === customer['Customer ID']);
    const totalBilled = customerTrips.reduce((sum, trip) => sum + (parseFloat(String(trip['Gross Income']).replace(/[^0-9.-]/g, '')) || 0), 0);
    const totalPaid = customerPayments.reduce((sum, payment) => sum + (parseFloat(String(payment['Amount']).replace(/[^0-9.-]/g, '')) || 0), 0);
    return { customerId: customer['Customer ID'], customerName: customer['Customer Name'], companyName: customer['Company Name'], contactNumber: customer['Contact Number'], totalTrips: customerTrips.length, totalBilled: totalBilled, totalPaid: totalPaid, balance: totalBilled - totalPaid, creditLimit: parseFloat(String(customer['Credit Limit']).replace(/[^0-9.-]/g, '')) || 0, paymentTerms: customer['Payment Terms'], status: customer['Status'] };
  });
  return { companyName: data.settings['Company Name'] || 'Reyna', reportTitle: 'CUSTOMER REPORT', customers: customerDetails, totalCustomers: data.customers.length, activeCustomers: data.customers.filter(c => c['Status'] === 'Active').length };
}

function generateDriversReport_(data) {
  const startDate = new Date(data.dateRange.startDate); const endDate = new Date(data.dateRange.endDate);
  const filteredTrips = data.trips.filter(trip => { const d = parseDate_(trip['Date']); return d && d >= startDate && d <= endDate; });
  const driverDetails = data.drivers.map(driver => {
    const driverTrips = filteredTrips.filter(t => t['Driver ID'] === driver['Driver ID']);
    const totalRevenue = driverTrips.reduce((sum, trip) => sum + (parseFloat(String(trip['Gross Income']).replace(/[^0-9.-]/g, '')) || 0), 0);
    const totalProfit = driverTrips.reduce((sum, trip) => sum + (parseFloat(String(trip['Net Profit']).replace(/[^0-9.-]/g, '')) || 0), 0);
    const estimatedPay = driverTrips.reduce((sum, trip) => sum + (parseFloat(String(trip['Driver Pay']).replace(/[^0-9.-]/g, '')) || 0), 0);
    return { driverId: driver['Driver ID'], driverName: driver['Driver Name'], licenseNumber: driver['License Number'], contactNumber: driver['Contact Number'], totalTrips: driverTrips.length, totalRevenue: totalRevenue, totalProfit: totalProfit, estimatedPay: estimatedPay, avgRevenuePerTrip: driverTrips.length > 0 ? (totalRevenue / driverTrips.length) : 0, status: driver['Status'] };
  });
  return { companyName: data.settings['Company Name'] || 'Reyna', reportTitle: 'DRIVERS PERFORMANCE REPORT', drivers: driverDetails, totalDrivers: data.drivers.length, activeDrivers: data.drivers.filter(d => d['Status'] === 'Active').length };
}

function generateAccountsReceivableReport_(data) {
  return {
    companyName: data.settings['Company Name'] || 'Reyna', reportTitle: 'ACCOUNTS RECEIVABLE REPORT',
    receivables: data.analytics.accountReceivables.map(ar => ({ customerId: ar.customerId, customerName: ar.customerName, totalBilled: ar.totalBilled, totalPaid: ar.totalPaid, balance: ar.balance, creditLimit: ar.creditLimit, paymentTerms: ar.paymentTerms, utilizationPercent: ar.creditLimit > 0 ? ((ar.balance / ar.creditLimit) * 100).toFixed(2) : 0 })),
    totalReceivables: data.analytics.totalReceivables, totalBilled: data.analytics.accountReceivables.reduce((sum, ar) => sum + ar.totalBilled, 0), totalPaid: data.analytics.accountReceivables.reduce((sum, ar) => sum + ar.totalPaid, 0)
  };
}

function generatePaymentsReport_(data) {
  const startDate = new Date(data.dateRange.startDate); const endDate = new Date(data.dateRange.endDate);
  const filteredPayments = data.payments.filter(payment => { const d = parseDate_(payment['Payment Date']); return d && d >= startDate && d <= endDate; });
  const paymentsByMethod = {};
  filteredPayments.forEach(payment => { const method = payment['Payment Method'] || 'Cash'; const amount = parseFloat(String(payment['Amount']).replace(/[^0-9.-]/g, '')) || 0; paymentsByMethod[method] = (paymentsByMethod[method] || 0) + amount; });
  return {
    companyName: data.settings['Company Name'] || 'Reyna', reportTitle: 'PAYMENTS RECEIVED REPORT',
    payments: filteredPayments.map(payment => ({ paymentId: payment['Payment ID'], paymentDate: payment['Payment Date'], customerId: payment['Customer ID'], customerName: payment['Customer Name'], amount: parseFloat(String(payment['Amount']).replace(/[^0-9.-]/g, '')) || 0, paymentMethod: payment['Payment Method'], referenceNumber: payment['Reference Number'], notes: payment['Notes'] })),
    totalPayments: data.analytics.totalPaymentsReceived, paymentsByMethod: paymentsByMethod, totalTransactions: filteredPayments.length
  };
}
/** Permanently deletes a trip. Admins only; the deletion is written to the activity log. */
function deleteTripFromServer_(tripId) {
  adminOnly_();
  tripId = txt_(tripId);
  if (!tripId) return { success: false, error: 'Trip ID is missing.' };
  try {
    const rows = dbRequest_('delete', 'trips?trip_id=' + eq_(tripId), null, { Prefer: 'return=representation' }) || [];
    if (!rows.length) return { success: false, error: 'Trip not found.' };
    const t = rows[0];
    dbLog_('trip_deleted', tripId, 'customer=' + t.customer_name + ', date=' + t.trip_date + ', gross=' + t.gross_income);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

function updateTripInServer_(tripData) {
  try {
    const t = normalizeTrip_(tripData || {});
    if (!txt_(t.tripId)) return { success: false, error: 'Trip ID is missing.' };
    const changes = tripToDb_(t, true);                     // only the fields that were sent
    const rows = dbUpdate_('trips', 'trip_id=' + eq_(t.tripId), changes);
    if (!rows.length) return { success: false, error: 'Trip ID ' + t.tripId + ' not found.' };
    return { success: true };
  } catch (error) {
    return { success: false, error: dbFriendlyError_(error, 'This trip') };
  }
}


/* =====================================================================
 * LOGIN & SESSION SECURITY
 * ---------------------------------------------------------------------
 * - doGet() only ever serves the Login page. The dashboard HTML is returned
 *   by getApp() after a valid session token is presented.
 * - Every data/business function above is PRIVATE (name ends with "_"),
 *   so it cannot be called from a browser console with google.script.run.
 *   The browser can only call apiCall(), which checks the session first
 *   and then runs a function from the whitelist below.
 * - Passwords are never stored in plain text: a salted, iterated SHA-256
 *   hash is kept in Script Properties.
 * - Sessions live in the script cache (2h idle timeout, 12h max).
 * - 5 failed sign-ins lock that username for 15 minutes.
 * ===================================================================== */

const AUTH = {
  IDLE_SECONDS: 7200,            // sign out after 2 hours without activity
  MAX_SESSION_MS: 12 * 3600 * 1000,
  MAX_FAILS: 5,
  RECHECK_MS: 60000,             // re-check the account in the database at most once a minute
  LOCK_SECONDS: 900,             // 15 minutes
  HASH_ROUNDS: 500
};

// The ONLY functions the signed-in browser may run (called through apiCall).
const API_WHITELIST_ = {
  getDashboardData: getDashboardData_,
  addTruck: addTruck_,
  addHelper: addHelper_,
  addDriver: addDriver_,
  addCustomer: addCustomer_,
  addExpense: addExpense_,
  addPayment: addPayment_,
  addTrip: addTrip_,
  updateTripInServer: updateTripInServer_,
  calculateTripPricing: calculateTripPricing_,
  generatePayrollInvoice: generatePayrollInvoice_,
  getTripInvoice: getTripInvoice_,
  getCustomerStatement: getCustomerStatement_,
  generateReports: generateReports_,
  updateResourceStatus: updateResourceStatus_,
  deleteTripFromServer: deleteTripFromServer_,
  // user management (admins only — enforced again on the server in apiCall)
  listUsers: listUsers_,
  createUser: createUser_,
  setUserActive: setUserActive_,
  resetUserPassword: resetUserPassword_
};
const ADMIN_API_ = { listUsers: true, createUser: true, setUserActive: true, resetUserPassword: true, deleteTripFromServer: true };
let CURRENT_SESSION_ = null;   // the signed-in user for the request currently being handled

/** Serves the login page (nothing else is reachable without signing in). */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Login')
    .setTitle('Sign In | LIMARS Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called by the login page. Returns {success, token} or {success:false, message}. */
function login(username, password) {
  username = String(username || '').trim().toLowerCase();
  password = String(password || '');
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + sha256Hex_(username);

  if (!USERNAME_PATTERN_.test(username) || !password) {
    Utilities.sleep(800);
    return { success: false, message: 'Invalid username or password.' };
  }
  if (parseInt(cache.get(failKey) || '0', 10) >= AUTH.MAX_FAILS) {
    return { success: false, message: 'Too many failed attempts. Try again in 15 minutes.' };
  }

  let user = null;
  try {
    user = dbGetUser_(username);
  } catch (err) {
    console.error('Login database error: ' + err);
    return { success: false, message: 'The sign-in service is unavailable. Please try again later.' };
  }

  // Hash even for unknown users so timing does not reveal which usernames exist.
  const salt = user ? user.salt : 'x'.repeat(32);
  const computed = hashPassword_(salt, password);
  const ok = !!user && user.is_active !== false && safeEqual_(computed, String(user.password_hash));

  if (!ok) {
    const fails = parseInt(cache.get(failKey) || '0', 10) + 1;
    cache.put(failKey, String(fails), AUTH.LOCK_SECONDS);
    Utilities.sleep(800);
    return { success: false, message: 'Invalid username or password.' };
  }

  cache.remove(failKey);
  try { dbTouchLogin_(username); } catch (err) { console.error('last_login update failed: ' + err); }
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const now = Date.now();
  const session = { u: username, r: user.role === 'admin' ? 'admin' : 'employee', n: user.full_name || '',
                    m: !!user.must_change_password, c: now, k: now };
  putSession_(token, session);
  return { success: true, token: token, mustChange: session.m };
}

/** Returns the dashboard HTML for a valid session (token is injected for the page). */
function getApp(token) {
  const s = requireSession_(token);   // throws if the password still has to be changed
  const html = HtmlService.createHtmlOutputFromFile('Index').getContent();
  const inject = '<script>window.__SESSION_TOKEN__=' + safeJson_(String(token)) +
    ';window.__APP_URL__=' + safeJson_(ScriptApp.getService().getUrl() || '') +
    ';window.__USER__=' + safeJson_({ username: s.u, fullName: s.n, role: s.r }) + ';</script>';
  return html.replace('<head>', '<head>' + inject);
}

/** Single entry point for every dashboard request. */
function apiCall(token, fnName, args) {
  const s = requireSession_(token);
  if (!Object.prototype.hasOwnProperty.call(API_WHITELIST_, fnName)) {
    throw new Error('Unknown action.');
  }
  if (ADMIN_API_[fnName] && s.r !== 'admin') throw new Error('Not allowed.');
  CURRENT_SESSION_ = s;
  const result = API_WHITELIST_[fnName].apply(null, args || []);
  // Date objects cannot be sent to the browser (the page would wait forever), so turn them into text.
  return result === undefined ? null : JSON.parse(JSON.stringify(result));
}

function logout(token) {
  try { CacheService.getScriptCache().remove('sess_' + sha256Hex_(String(token))); } catch (e) {}
  return true;
}

/* ---------------------------- internals ---------------------------- */

function putSession_(token, s) {
  CacheService.getScriptCache().put('sess_' + sha256Hex_(String(token)), JSON.stringify(s), AUTH.IDLE_SECONDS);
}

/** Valid, active session or an error. Re-reads the account every minute so that
 *  disabling an employee (or changing their role) takes effect quickly. */
function requireSession_(token, allowPendingPasswordChange) {
  const cache = CacheService.getScriptCache();
  const key = 'sess_' + sha256Hex_(String(token || ''));
  const raw = token ? cache.get(key) : null;
  if (!raw) throw new Error('AUTH_REQUIRED');
  const s = JSON.parse(raw);
  if (Date.now() - s.c > AUTH.MAX_SESSION_MS) { cache.remove(key); throw new Error('AUTH_REQUIRED'); }
  if (!s.k || Date.now() - s.k > AUTH.RECHECK_MS) {
    try {
      const user = dbGetUser_(s.u);
      if (!user || user.is_active === false) { cache.remove(key); throw new Error('AUTH_REQUIRED'); }
      s.r = user.role === 'admin' ? 'admin' : 'employee';
      s.n = user.full_name || '';
      s.m = !!user.must_change_password;
      s.k = Date.now();
    } catch (err) {
      if (String(err.message) === 'AUTH_REQUIRED') throw err;
      console.error('Session re-check failed: ' + err);   // database hiccup: keep the session, retry next call
    }
  }
  cache.put(key, JSON.stringify(s), AUTH.IDLE_SECONDS);
  if (s.m && !allowPendingPasswordChange) throw new Error('PASSWORD_CHANGE_REQUIRED');
  return s;
}

/** JSON that is safe to place inside a <script> tag. */
function safeJson_(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function toHex_(bytes) {
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function sha256Hex_(text) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
}
function hashPassword_(salt, password) {
  const saltBytes = Utilities.newBlob(salt).getBytes();
  let h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.newBlob(salt + ':' + password).getBytes());
  for (let i = 0; i < AUTH.HASH_ROUNDS; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h.concat(saltBytes));
  }
  return toHex_(h);
}
function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* =====================================================================
 * ONE-TIME SETUP — run from the Apps Script editor (never from the web)
 * 1. Type a username and a strong password below (12+ characters).
 * 2. Select "setupLogin" in the editor and click Run.
 * 3. Delete the password from this file again and save.
 * Run it again with the same username to change that user's password,
 * or with a new username to add another user.
 * ===================================================================== */

/* ------------------- Postgres (Supabase) user database ------------------- */

const USERNAME_PATTERN_ = /^[a-z0-9._-]{3,50}$/;

function dbConfig_() {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty('DB_URL');
  const key = p.getProperty('DB_KEY');
  if (!url || !key) throw new Error('Database connection is not configured. Run setupDatabaseConnection() first.');
  return { url: url.replace(/\/+$/, ''), key: key };
}

/** Calls the Postgres REST API (PostgREST). The secret key stays on the server. */
function dbRequest_(method, path, body, extraHeaders) {
  const c = dbConfig_();
  const headers = { apikey: c.key, Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' };
  Object.keys(extraHeaders || {}).forEach(function (k) { headers[k] = extraHeaders[k]; });
  const options = { method: method, headers: headers, muteHttpExceptions: true };
  if (body !== undefined && body !== null) options.payload = JSON.stringify(body);
  const res = UrlFetchApp.fetch(c.url + '/rest/v1/' + path, options);
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('Database error ' + code + ': ' + String(text).slice(0, 200));
  return text ? JSON.parse(text) : null;
}

function dbGetUser_(username) {
  const rows = dbRequest_('get', 'app_users?username=eq.' + encodeURIComponent(username) +
    '&select=username,full_name,salt,password_hash,role,is_active,must_change_password&limit=1');
  return (rows && rows[0]) || null;
}

function dbTouchLogin_(username) {
  dbRequest_('patch', 'app_users?username=eq.' + encodeURIComponent(username),
    { last_login: new Date().toISOString() }, { Prefer: 'return=minimal' });
}

/* =====================================================================
 * ONE-TIME SETUP, STEP 1 — connect to the database
 * Paste your Supabase project URL and SECRET key below, select
 * "setupDatabaseConnection" in the editor, click Run, then DELETE the key
 * from this file. The key is then kept only in Script Properties.
 * ===================================================================== */
function setupDatabaseConnection() {
  const DB_URL = '';   // e.g. https://abcdefgh.supabase.co
  const DB_KEY = '';   // the SECRET key (sb_secret_...) — never the publishable/anon key

  if (!/^https:\/\/.+/.test(DB_URL) || !DB_KEY) {
    throw new Error('Fill in DB_URL (https://...) and DB_KEY inside setupDatabaseConnection() first.');
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty('DB_URL', DB_URL);
  props.setProperty('DB_KEY', DB_KEY);
  const rows = dbRequest_('get', 'app_users?select=username&limit=1');   // connection test
  Logger.log('Database connected. app_users table found (' + rows.length + ' row(s) returned). Now delete the key from the code.');
}

/** Optional: run this daily from a time-driven trigger so a free database is not paused for inactivity. */
function keepDatabaseAwake() {
  dbRequest_('get', 'app_users?select=id&limit=1');
}

function setupLogin() {
  const USERNAME = 'admin';
  const PASSWORD = '';
  const ROLE = 'admin';

  const username = USERNAME.toLowerCase();
  if (!USERNAME_PATTERN_.test(username)) {
    throw new Error('Username must be 3-50 characters: letters, numbers, dot, dash or underscore.');
  }
  if (PASSWORD.length < 12) {
    throw new Error('Set a password of at least 12 characters in setupLogin() before running it.');
  }
  const salt = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  dbRequest_('post', 'app_users?on_conflict=username',
    { username: username, salt: salt, password_hash: hashPassword_(salt, PASSWORD), role: ROLE, is_active: true, must_change_password: false },
    { Prefer: 'resolution=merge-duplicates,return=minimal' });
  CacheService.getScriptCache().remove('fail_' + sha256Hex_(username));
  Logger.log('Login saved to the database for "' + username + '". Now delete the password from the code.');
}


/* =====================================================================
 * ACCOUNT MANAGEMENT (admin) + CHANGE PASSWORD (everyone)
 * ===================================================================== */

function adminOnly_() {
  if (!CURRENT_SESSION_ || CURRENT_SESSION_.r !== 'admin') throw new Error('Not allowed.');
}

function dbLog_(action, target, details) {
  try {
    dbRequest_('post', 'user_audit_log',
      { actor: CURRENT_SESSION_ ? CURRENT_SESSION_.u : null, action: action, target: target || null, details: details || null },
      { Prefer: 'return=minimal' });
  } catch (err) { console.error('Audit log failed: ' + err); }
}

/** 16 random characters (80 bits) in groups of four, e.g. K7M2-9QXA-PT4R-WE5N. No look-alike characters. */
function generateTempPassword_() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // exactly 32 characters, so no modulo bias
  let chars = '';
  while (chars.length < 16) {
    const hex = Utilities.getUuid().replace(/-/g, '');
    for (let i = 0; i < 16 && chars.length < 16; i++) {
      if (i === 6 || i === 8) continue;                  // bytes that contain fixed UUID bits
      chars += alphabet.charAt(parseInt(hex.substr(i * 2, 2), 16) % 32);
    }
  }
  return chars.replace(/(.{4})(?=.)/g, '$1-');
}

function newSalt_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

function countActiveAdmins_() {
  return (dbRequest_('get', 'app_users?role=eq.admin&is_active=eq.true&select=username') || []).length;
}

function listUsers_() {
  adminOnly_();
  const rows = dbRequest_('get', 'app_users?select=username,full_name,role,is_active,must_change_password,last_login,created_at,created_by&order=created_at.asc') || [];
  // Belt and braces: password data must never leave the server.
  return rows.map(function (u) { delete u.salt; delete u.password_hash; return u; });
}

function createUser_(data) {
  adminOnly_();
  const username = String((data && data.username) || '').trim().toLowerCase();
  const fullName = String((data && data.fullName) || '').trim().slice(0, 100);
  const role = (data && data.role === 'admin') ? 'admin' : 'employee';
  if (!USERNAME_PATTERN_.test(username)) return { success: false, error: 'Username must be 3-50 characters: letters, numbers, dot, dash or underscore.' };
  if (!fullName) return { success: false, error: "Enter the employee's full name." };

  const temp = generateTempPassword_();
  const salt = newSalt_();
  try {
    dbRequest_('post', 'app_users',
      { username: username, full_name: fullName, role: role, salt: salt, password_hash: hashPassword_(salt, temp),
        is_active: true, must_change_password: true, created_by: CURRENT_SESSION_.u },
      { Prefer: 'return=minimal' });
  } catch (err) {
    if (String(err).indexOf('Database error 409') > -1) return { success: false, error: 'That username already exists.' };
    throw err;
  }
  dbLog_('user_created', username, 'role=' + role);
  return { success: true, username: username, fullName: fullName, role: role, tempPassword: temp };
}

function setUserActive_(username, active) {
  adminOnly_();
  username = String(username || '').trim().toLowerCase();
  active = !!active;
  if (!USERNAME_PATTERN_.test(username)) return { success: false, error: 'Invalid username.' };
  if (!active && username === CURRENT_SESSION_.u) return { success: false, error: 'You cannot disable your own account.' };
  const target = dbGetUser_(username);
  if (!target) return { success: false, error: 'User not found.' };
  if (!active && target.role === 'admin' && target.is_active !== false && countActiveAdmins_() <= 1) {
    return { success: false, error: 'You cannot disable the last active admin.' };
  }
  dbRequest_('patch', 'app_users?username=eq.' + encodeURIComponent(username), { is_active: active }, { Prefer: 'return=minimal' });
  dbLog_(active ? 'user_enabled' : 'user_disabled', username, null);
  return { success: true };
}

function resetUserPassword_(username) {
  adminOnly_();
  username = String(username || '').trim().toLowerCase();
  if (!USERNAME_PATTERN_.test(username)) return { success: false, error: 'Invalid username.' };
  if (username === CURRENT_SESSION_.u) return { success: false, error: 'Use Change Password for your own account.' };
  if (!dbGetUser_(username)) return { success: false, error: 'User not found.' };
  const temp = generateTempPassword_();
  const salt = newSalt_();
  dbRequest_('patch', 'app_users?username=eq.' + encodeURIComponent(username),
    { salt: salt, password_hash: hashPassword_(salt, temp), must_change_password: true }, { Prefer: 'return=minimal' });
  CacheService.getScriptCache().remove('fail_' + sha256Hex_(username));   // also clears a lockout
  dbLog_('password_reset', username, null);
  return { success: true, username: username, tempPassword: temp };
}

function passwordProblem_(pw, username, oldPw) {
  if (pw.length < 12) return 'The new password must be at least 12 characters.';
  if (pw === oldPw) return 'The new password must be different from the current one.';
  if (pw.toLowerCase().indexOf(username) > -1) return 'The new password must not contain your username.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use at least one letter and one number.';
  return '';
}

/** Used by the forced "set your new password" step and by Change Password. */
function changePassword(token, currentPassword, newPassword) {
  const s = requireSession_(token, true);
  currentPassword = String(currentPassword || '');
  newPassword = String(newPassword || '');
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + sha256Hex_(s.u);
  const fails = parseInt(cache.get(failKey) || '0', 10);
  if (fails >= AUTH.MAX_FAILS) return { success: false, message: 'Too many failed attempts. Try again in 15 minutes.' };

  const user = dbGetUser_(s.u);
  if (!user || user.is_active === false) throw new Error('AUTH_REQUIRED');
  if (!safeEqual_(hashPassword_(user.salt, currentPassword), String(user.password_hash))) {
    cache.put(failKey, String(fails + 1), AUTH.LOCK_SECONDS);
    Utilities.sleep(800);
    return { success: false, message: 'Current password is incorrect.' };
  }
  const problem = passwordProblem_(newPassword, s.u, currentPassword);
  if (problem) return { success: false, message: problem };

  const salt = newSalt_();
  dbRequest_('patch', 'app_users?username=eq.' + encodeURIComponent(s.u),
    { salt: salt, password_hash: hashPassword_(salt, newPassword), must_change_password: false, password_changed_at: new Date().toISOString() },
    { Prefer: 'return=minimal' });
  s.m = false;
  putSession_(token, s);
  CURRENT_SESSION_ = s;
  dbLog_('password_changed', s.u, null);
  return { success: true };
}


/* =====================================================================
 * AVAILABILITY STATUS for drivers, helpers and trucks
 * A blank status or "Active" means available. Anything else (Day Off,
 * Unavailable, Resigned, Under Maintenance) blocks them from new trips.
 * ===================================================================== */
const PEOPLE_STATUSES_ = ['Active', 'Day Off', 'Unavailable', 'Resigned'];
const RESOURCE_TYPES_ = {
  drivers: { table: 'drivers', idColumn: 'driver_id', statuses: PEOPLE_STATUSES_ },
  helpers: { table: 'helpers', idColumn: 'helper_id', statuses: PEOPLE_STATUSES_ },
  trucks:  { table: 'trucks',  idColumn: 'truck_id',  statuses: ['Active', 'Under Maintenance', 'Unavailable'] }
};

function isAvailableStatus_(status) {
  const s = String(status === undefined || status === null ? '' : status).trim().toLowerCase();
  return s === '' || s === 'active';
}

function updateResourceStatus_(type, id, status) {
  const cfg = RESOURCE_TYPES_[String(type)];
  if (!cfg) return { success: false, error: 'Unknown type.' };
  status = String(status || '').trim();
  if (cfg.statuses.indexOf(status) === -1) return { success: false, error: 'Invalid status.' };
  try {
    const rows = dbUpdate_(cfg.table, cfg.idColumn + '=' + eq_(id), { status: status });
    if (!rows.length) return { success: false, error: 'Record not found.' };
    return { success: true, status: status };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/** Names of anything chosen for a trip that is currently not available. */
function findUnavailableResources_(t) {
  const bad = [];
  const driverId = String(t.driverId || '');
  if (driverId) {
    const d = getTableData_(SHEETS.DRIVERS).filter(function (r) { return String(r['Driver ID']) === driverId; })[0];
    if (d && !isAvailableStatus_(d['Status'])) bad.push(d['Driver Name'] + ' (' + d['Status'] + ')');
  }
  const plates = String(t.trucksData || '').split(',').map(function (p) { return p.trim(); }).filter(Boolean);
  if (plates.length) {
    getTableData_(SHEETS.TRUCKS).forEach(function (r) {
      if (plates.indexOf(String(r['Plate Number'])) > -1 && !isAvailableStatus_(r['Status'])) bad.push(r['Plate Number'] + ' (' + r['Status'] + ')');
    });
  }
  let helpers = [];
  try { helpers = JSON.parse(t.helpersData || '[]'); } catch (e) {}
  const names = helpers.map(function (h) { return String(h && h.name || ''); }).filter(Boolean);
  if (names.length) {
    getTableData_(SHEETS.HELPERS).forEach(function (r) {
      if (names.indexOf(String(r['Helper Name'])) > -1 && !isAvailableStatus_(r['Status'])) bad.push(r['Helper Name'] + ' (' + r['Status'] + ')');
    });
  }
  return bad;
}
