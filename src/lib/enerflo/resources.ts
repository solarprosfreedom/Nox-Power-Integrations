// Enerflo API endpoint catalog — paths confirmed from official docs.
// All v3 paths are verified: true. v1-only paths remain where no v3 equivalent exists.

export type ParamLocation = "path" | "query" | "body";

export type ParamType =
  | "string" | "number" | "boolean" | "email" | "tel"
  | "password" | "select" | "textarea";

export type ParamDef = {
  name: string;
  label: string;
  type: ParamType;
  location: ParamLocation;
  options?: string[];
  required?: boolean;
  placeholder?: string;
  description?: string;
};

export type EndpointDef = {
  id: string;
  label: string;
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  description: string;
  params: ParamDef[];
  verified?: boolean; // true = confirmed from official docs
};

export type ResourceDef = {
  id: string;
  label: string;
  icon: string;
  endpoints: EndpointDef[];
};

// ─────────────────────────────────────────────────────────────────────────────
export const ENERFLO_RESOURCES: ResourceDef[] = [

  // ── Authentication ────────────────────────────────────────────────────────
  {
    id: "auth",
    label: "Authentication",
    icon: "🔐",
    endpoints: [
      {
        id: "authcheck",
        label: "Validate API Key",
        method: "GET",
        path: "/api/v3/authcheck",
        description: "Validate that your API key is active and has the correct permissions. Use this to confirm your key works before making other calls.",
        verified: true,
        params: [],
      },
    ],
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────
  {
    id: "tasks",
    label: "Tasks",
    icon: "✅",
    endpoints: [
      {
        id: "create-task",
        label: "Create Task",
        method: "POST",
        path: "/api/v1/tasks",
        description: "Create a new task linked to a customer or user.",
        verified: true,
        params: [
          { name: "customer_id", label: "Customer ID",  type: "number", location: "body", required: true, placeholder: "12345" },
          { name: "title",       label: "Title",        type: "string", location: "body", required: true, placeholder: "Follow-up call" },
          { name: "description", label: "Description",  type: "textarea", location: "body", placeholder: "Task details..." },
          { name: "due_date",    label: "Due Date",     type: "string", location: "body", placeholder: "2026-05-15" },
          { name: "assigned_to", label: "Assigned To (user ID)", type: "number", location: "body", placeholder: "1" },
        ],
      },
      {
        id: "get-all-tasks",
        label: "Retrieve All Tasks",
        method: "POST",
        path: "/api/v3/tasks/all",
        description: "Retrieve all tasks scoped to your API key. Uses POST body for filtering.",
        verified: true,
        params: [
          { name: "page",     label: "Page",      type: "number", location: "body", placeholder: "1" },
          { name: "pageSize", label: "Page Size", type: "number", location: "body", placeholder: "25" },
        ],
      },
      {
        id: "get-customer-tasks",
        label: "Get Tasks for Customer",
        method: "GET",
        path: "/api/v1/tasks/{customerId}",
        description: "Retrieve all tasks associated with a specific customer.",
        verified: true,
        params: [
          { name: "customerId", label: "Customer ID", type: "number", location: "path", required: true, placeholder: "12345" },
        ],
      },
    ],
  },

  // ── Users ─────────────────────────────────────────────────────────────────
  {
    id: "users",
    label: "Users",
    icon: "👤",
    endpoints: [
      {
        id: "create-user",
        label: "Create User",
        method: "POST",
        path: "/api/v1/users",
        description: "Create a new Enerflo user (rep, manager, etc.). Used when a new hire completes Sequifi onboarding.",
        verified: true,
        params: [
          { name: "first_name",       label: "First Name",   type: "string",  location: "body", required: true,  placeholder: "Jane" },
          { name: "last_name",        label: "Last Name",    type: "string",  location: "body", required: true,  placeholder: "Smith" },
          { name: "email",            label: "Email",        type: "email",   location: "body", required: true,  placeholder: "jane@company.com" },
          { name: "phone",            label: "Phone",        type: "tel",     location: "body", placeholder: "+1 555 000 0000" },
          { name: "roles",            label: "Roles (comma-separated)", type: "string", location: "body", required: true, placeholder: "agent,setter" },
          { name: "notify_email",     label: "Notify by Email", type: "boolean", location: "body", placeholder: "true" },
          { name: "can_create_customers", label: "Can Create Customers", type: "boolean", location: "body", placeholder: "true" },
          { name: "allow_optimus",    label: "Allow Optimus", type: "boolean", location: "body", placeholder: "false" },
          { name: "can_reassign_leads", label: "Can Reassign Leads", type: "boolean", location: "body", placeholder: "true" },
          { name: "timezone",         label: "Timezone",     type: "string",  location: "body", placeholder: "America/Phoenix" },
          { name: "external_user_id", label: "External User ID", type: "string", location: "body", placeholder: "sequifi-employee-id" },
          { name: "manager_email",    label: "Manager Email", type: "email",  location: "body", placeholder: "manager@company.com" },
          { name: "office_id",        label: "Office ID",    type: "string",  location: "body", placeholder: "office-uuid" },
          { name: "password",         label: "Password",     type: "password", location: "body", placeholder: "Temporary password" },
        ],
      },
      {
        id: "get-users",
        label: "Get All Users",
        method: "GET",
        path: "/api/v3/users",
        description: "Retrieve all users in your Enerflo account with optional role and pagination filters. Used to build rep rosters for Terros attribution.",
        verified: true,
        params: [
          {
            name: "user_role", label: "Role Filter", type: "select", location: "query",
            options: [
              "","callcenter","callcentermanager","company","dealapproval","officeadmin",
              "ops","projectmanager","regionalmanager","agent","manager","scheduler",
              "setter","sitesurveyor","solardesigns","solarinstaller","subcontractor",
              "supercompany","surveyor",
            ],
            placeholder: "All roles",
          },
          { name: "company_id", label: "Company ID", type: "number", location: "query", placeholder: "Optional" },
          { name: "page",       label: "Page",       type: "number", location: "query", placeholder: "1" },
          { name: "pageSize",   label: "Page Size",  type: "number", location: "query", placeholder: "25" },
        ],
      },
      {
        id: "update-user",
        label: "Update User",
        method: "PUT",
        path: "/api/v3/users",
        description: "Update an existing Enerflo user's profile or role.",
        verified: true,
        params: [
          { name: "id",         label: "User ID",    type: "number", location: "body", required: true, placeholder: "1" },
          { name: "first_name", label: "First Name", type: "string", location: "body", placeholder: "Jane" },
          { name: "last_name",  label: "Last Name",  type: "string", location: "body", placeholder: "Smith" },
          { name: "email",      label: "Email",      type: "email",  location: "body", placeholder: "jane@company.com" },
          { name: "roles",      label: "Roles",      type: "string", location: "body", placeholder: "agent,setter" },
        ],
      },
      {
        id: "get-user",
        label: "Get User by ID",
        method: "GET",
        path: "/api/v3/users/{id}",
        description: "Retrieve a single Enerflo user's full details by their ID.",
        verified: true,
        params: [
          { name: "id", label: "User ID", type: "number", location: "path", required: true, placeholder: "1" },
        ],
      },
    ],
  },

  // ── Installs ──────────────────────────────────────────────────────────────
  {
    id: "installs",
    label: "Installs",
    icon: "🏗️",
    endpoints: [
      {
        id: "create-install",
        label: "Create Install",
        method: "POST",
        path: "/api/v1/ob/installs",
        description: "Create a new installation record for a customer project.",
        verified: true,
        params: [
          { name: "customer_id", label: "Customer ID", type: "number", location: "body", required: true, placeholder: "12345" },
          { name: "install_date", label: "Install Date", type: "string", location: "body", placeholder: "2026-06-15" },
          { name: "status",      label: "Status",       type: "string", location: "body", placeholder: "scheduled" },
        ],
      },
      {
        id: "get-installs",
        label: "Get Installs (List)",
        method: "GET",
        path: "/api/v3/installs",
        description: "Retrieve a paginated list of installation records. Key source for project details to push to Terros leaderboard.",
        verified: true,
        params: [
          { name: "page",     label: "Page",      type: "number", location: "query", placeholder: "1" },
          { name: "pageSize", label: "Page Size", type: "number", location: "query", placeholder: "25" },
        ],
      },
      {
        id: "get-all-installs",
        label: "Get All Installs (POST)",
        method: "POST",
        path: "/api/v3/installs/all",
        description: "Retrieve all installs using POST body for advanced filtering. Preferred for bulk exports to Terros.",
        verified: true,
        params: [
          { name: "page",      label: "Page",      type: "number", location: "body", placeholder: "1" },
          { name: "pageSize",  label: "Page Size", type: "number", location: "body", placeholder: "25" },
          { name: "status",    label: "Status Filter", type: "string", location: "body", placeholder: "completed" },
        ],
      },
      {
        id: "get-installs-metadata",
        label: "Get Install Metadata",
        method: "GET",
        path: "/api/v3/installs/meta-data",
        description: "Retrieve metadata about installs (field definitions, status options, etc.).",
        verified: true,
        params: [],
      },
      {
        id: "get-install",
        label: "Get Install by ID",
        method: "GET",
        path: "/api/v3/installs/{id}",
        description: "Get full project details for a single install: rep attribution, status, dates, office, customer. Primary source for Terros leaderboard pushes.",
        verified: true,
        params: [
          { name: "id", label: "Install ID", type: "number", location: "path", required: true, placeholder: "1" },
        ],
      },
      {
        id: "update-install",
        label: "Update Install",
        method: "PUT",
        path: "/api/v3/installs/{id}",
        description: "Update install record fields such as status, dates, or assigned rep.",
        verified: true,
        params: [
          { name: "id",     label: "Install ID", type: "number", location: "path", required: true, placeholder: "1" },
          { name: "status", label: "Status",     type: "string", location: "body", placeholder: "completed" },
        ],
      },
      {
        id: "update-install-v1",
        label: "Update Install (v1)",
        method: "PUT",
        path: "/api/v1/installs/{installId}",
        description: "v1 endpoint for updating install records. Prefer /v3/installs/{id} when possible.",
        verified: true,
        params: [
          { name: "installId", label: "Install ID", type: "number", location: "path", required: true, placeholder: "1" },
          { name: "status",    label: "Status",     type: "string", location: "body", placeholder: "completed" },
        ],
      },
      {
        id: "export-installs-xlsx",
        label: "Export Installs as Excel",
        method: "GET",
        path: "/api/v3/installs.xlsx",
        description: "Download all install records as an Excel file for reporting.",
        verified: true,
        params: [],
      },
    ],
  },

  // ── Install Milestones ────────────────────────────────────────────────────
  {
    id: "install-milestones",
    label: "Install Milestones",
    icon: "🚩",
    endpoints: [
      {
        id: "create-milestone",
        label: "Create Milestone",
        method: "POST",
        path: "/api/v3/installs/milestones",
        description: "Create a new milestone definition for installs (e.g. Permit Submitted, Panel Delivery, PTO).",
        verified: true,
        params: [
          { name: "name",        label: "Milestone Name", type: "string", location: "body", required: true, placeholder: "Permit Submitted" },
          { name: "description", label: "Description",    type: "textarea", location: "body", placeholder: "Milestone description" },
        ],
      },
      {
        id: "update-milestone",
        label: "Update Milestone",
        method: "PUT",
        path: "/api/v3/installs/{id}/milestones/{milestoneId}",
        description: "Mark a milestone as reached for a specific install. Triggers a Terros stat push when wired to an automation.",
        verified: true,
        params: [
          { name: "id",          label: "Install ID",    type: "number", location: "path", required: true, placeholder: "1" },
          { name: "milestoneId", label: "Milestone ID",  type: "number", location: "path", required: true, placeholder: "5" },
          { name: "status",      label: "Status",        type: "string", location: "body", placeholder: "completed" },
          { name: "completed_at", label: "Completed At", type: "string", location: "body", placeholder: "2026-05-01T10:00:00Z" },
        ],
      },
      {
        id: "patch-milestone",
        label: "Partially Update Milestone",
        method: "PATCH",
        path: "/api/v3/installs/{id}/milestones/{milestoneId}",
        description: "Partially update a milestone (e.g. just the date or status) without replacing the full record.",
        verified: true,
        params: [
          { name: "id",          label: "Install ID",   type: "number", location: "path", required: true, placeholder: "1" },
          { name: "milestoneId", label: "Milestone ID", type: "number", location: "path", required: true, placeholder: "5" },
          { name: "status",      label: "Status",       type: "string", location: "body", placeholder: "completed" },
        ],
      },
    ],
  },

  // ── Install Notes ─────────────────────────────────────────────────────────
  {
    id: "install-notes",
    label: "Install Notes",
    icon: "📝",
    endpoints: [
      {
        id: "get-install-notes",
        label: "Get Install Notes",
        method: "GET",
        path: "/api/v3/installs/notes",
        description: "Retrieve all notes across installs.",
        verified: true,
        params: [],
      },
      {
        id: "add-install-note",
        label: "Add Note to Install",
        method: "POST",
        path: "/api/v3/installs/{id}/notes",
        description: "Add a note to a specific install record.",
        verified: true,
        params: [
          { name: "id",      label: "Install ID", type: "number",   location: "path", required: true, placeholder: "1" },
          { name: "content", label: "Note",       type: "textarea", location: "body", required: true, placeholder: "Note content" },
        ],
      },
      {
        id: "delete-install-note",
        label: "Delete Install Note",
        method: "DELETE",
        path: "/api/v3/installs/{id}/notes/{noteId}",
        description: "Delete a specific note from an install.",
        verified: true,
        params: [
          { name: "id",     label: "Install ID", type: "number", location: "path", required: true, placeholder: "1" },
          { name: "noteId", label: "Note ID",    type: "number", location: "path", required: true, placeholder: "10" },
        ],
      },
    ],
  },

  // ── Install Reports ───────────────────────────────────────────────────────
  {
    id: "install-reports",
    label: "Install Reports",
    icon: "📄",
    endpoints: [
      {
        id: "get-install-reports",
        label: "Get All Install Reports",
        method: "GET",
        path: "/api/v3/install-reports",
        description: "Retrieve all installation completion reports. Used to confirm a project is fully done and push final stats to Terros.",
        verified: true,
        params: [
          { name: "page",     label: "Page",      type: "number", location: "query", placeholder: "1" },
          { name: "pageSize", label: "Page Size", type: "number", location: "query", placeholder: "25" },
        ],
      },
      {
        id: "create-install-report",
        label: "Create Install Report",
        method: "POST",
        path: "/api/v3/install-reports",
        description: "Create an installation completion report for a finished project.",
        verified: true,
        params: [
          { name: "install_id",  label: "Install ID",       type: "number", location: "body", required: true, placeholder: "1" },
          { name: "report_date", label: "Report Date",      type: "string", location: "body", placeholder: "2026-05-01" },
          { name: "notes",       label: "Completion Notes", type: "textarea", location: "body", placeholder: "System fully operational" },
        ],
      },
      {
        id: "get-install-report",
        label: "Get Install Report by ID",
        method: "GET",
        path: "/api/v3/install-reports/{id}",
        description: "Get details of a specific install report.",
        verified: true,
        params: [
          { name: "id", label: "Report ID", type: "number", location: "path", required: true, placeholder: "1" },
        ],
      },
      {
        id: "update-install-report",
        label: "Update Install Report",
        method: "PUT",
        path: "/api/v3/install-reports/{id}",
        description: "Update an existing install report.",
        verified: true,
        params: [
          { name: "id",    label: "Report ID", type: "number",   location: "path", required: true, placeholder: "1" },
          { name: "notes", label: "Notes",     type: "textarea", location: "body", placeholder: "Updated notes" },
        ],
      },
      {
        id: "delete-install-report",
        label: "Delete Install Report",
        method: "DELETE",
        path: "/api/v3/install-reports/{id}",
        description: "Delete an install report.",
        verified: true,
        params: [
          { name: "id", label: "Report ID", type: "number", location: "path", required: true, placeholder: "1" },
        ],
      },
    ],
  },

  // ── Install Statuses ──────────────────────────────────────────────────────
  {
    id: "install-statuses",
    label: "Install Statuses",
    icon: "🔖",
    endpoints: [
      {
        id: "get-install-statuses",
        label: "Get Install Statuses",
        method: "GET",
        path: "/api/v3/install-statuses",
        description: "Retrieve all available install status options (e.g. scheduled, in-progress, completed). Used to populate status filters.",
        verified: true,
        params: [],
      },
    ],
  },

  // ── Appointments ─────────────────────────────────────────────────────────
  {
    id: "appointments",
    label: "Appointments",
    icon: "📅",
    endpoints: [
      {
        id: "create-appointment",
        label: "Create Appointment",
        method: "POST",
        path: "/api/v1/appointments",
        description: "Schedule a new appointment for a customer (setter → closer handoff).",
        verified: true,
        params: [
          { name: "customer_id",      label: "Customer ID",      type: "number", location: "body", required: true, placeholder: "12345" },
          { name: "appointment_date", label: "Appointment Date", type: "string", location: "body", required: true, placeholder: "2026-06-01T14:00:00Z" },
          { name: "assigned_to",      label: "Closer (user ID)", type: "number", location: "body", placeholder: "1" },
        ],
      },
      {
        id: "update-appointment",
        label: "Update Appointment",
        method: "PUT",
        path: "/api/v1/appointments/{appointmentId}",
        description: "Update an existing appointment (reschedule, re-assign closer, change outcome).",
        verified: true,
        params: [
          { name: "appointmentId",    label: "Appointment ID",   type: "number", location: "path", required: true, placeholder: "1" },
          { name: "appointment_date", label: "New Date",         type: "string", location: "body", placeholder: "2026-06-05T14:00:00Z" },
          { name: "status",           label: "Status",           type: "string", location: "body", placeholder: "completed" },
        ],
      },
      {
        id: "get-customer-appointments",
        label: "Get Customer Appointments",
        method: "GET",
        path: "/api/v3/customers/{id}/appointments",
        description: "Retrieve all appointments for a given customer. Useful for setter activity stats.",
        verified: true,
        params: [
          { name: "id", label: "Customer ID", type: "number", location: "path", required: true, placeholder: "12345" },
        ],
      },
      {
        id: "get-appointment",
        label: "Get Specific Appointment",
        method: "GET",
        path: "/api/v3/customers/{id}/appointments/{appointmentId}",
        description: "Retrieve details of a specific appointment for a customer.",
        verified: true,
        params: [
          { name: "id",            label: "Customer ID",    type: "number", location: "path", required: true, placeholder: "12345" },
          { name: "appointmentId", label: "Appointment ID", type: "number", location: "path", required: true, placeholder: "1" },
        ],
      },
    ],
  },

  // ── Customers ─────────────────────────────────────────────────────────────
  {
    id: "customers",
    label: "Customers",
    icon: "👥",
    endpoints: [
      {
        id: "get-customers",
        label: "Get All Customers",
        method: "GET",
        path: "/api/v1/customers",
        description: "List all customers with optional search and pagination.",
        verified: true,
        params: [
          { name: "search",   label: "Search",    type: "string", location: "query", placeholder: "Name, email, or phone" },
          { name: "page",     label: "Page",      type: "number", location: "query", placeholder: "1" },
          { name: "pageSize", label: "Page Size", type: "select", location: "query",
            options: ["10","25","50","100"], placeholder: "25" },
        ],
      },
      {
        id: "get-customer",
        label: "Get Customer by ID",
        method: "GET",
        path: "/api/v3/customers/{id}",
        description: "Retrieve a single customer's full details including address, assigned rep, and deal status.",
        verified: true,
        params: [
          { name: "id", label: "Customer ID", type: "number", location: "path", required: true, placeholder: "12345" },
        ],
      },
      {
        id: "update-customer",
        label: "Update Customer",
        method: "PUT",
        path: "/api/v3/customers/{id}",
        description: "Update a customer's profile fields.",
        verified: true,
        params: [
          { name: "id",         label: "Customer ID", type: "number", location: "path", required: true, placeholder: "12345" },
          { name: "first_name", label: "First Name",  type: "string", location: "body", placeholder: "Jane" },
          { name: "last_name",  label: "Last Name",   type: "string", location: "body", placeholder: "Smith" },
          { name: "email",      label: "Email",       type: "email",  location: "body", placeholder: "jane@example.com" },
        ],
      },
      {
        id: "get-customer-market",
        label: "Get Customer Market Info",
        method: "GET",
        path: "/api/v3/customers/{id}/market",
        description: "Retrieve the market/territory information for a customer's address. Useful for territory-based leaderboard segmentation.",
        verified: true,
        params: [
          { name: "id", label: "Customer ID", type: "number", location: "path", required: true, placeholder: "12345" },
        ],
      },
    ],
  },

  // ── Customer Tasks ────────────────────────────────────────────────────────
  {
    id: "customer-tasks",
    label: "Customer Tasks",
    icon: "📌",
    endpoints: [
      {
        id: "add-customer-task",
        label: "Add Task to Customer",
        method: "POST",
        path: "/api/v3/customers/{id}/tasks",
        description: "Create a task linked to a specific customer record.",
        verified: true,
        params: [
          { name: "id",    label: "Customer ID", type: "number",   location: "path", required: true, placeholder: "12345" },
          { name: "title", label: "Task Title",  type: "string",   location: "body", required: true, placeholder: "Follow up on install" },
          { name: "notes", label: "Notes",       type: "textarea", location: "body", placeholder: "Details..." },
        ],
      },
      {
        id: "update-customer-task",
        label: "Update Customer Task",
        method: "PUT",
        path: "/api/v3/customers/{customerId}/tasks/{taskId}",
        description: "Update an existing task linked to a customer.",
        verified: true,
        params: [
          { name: "customerId", label: "Customer ID", type: "number", location: "path", required: true, placeholder: "12345" },
          { name: "taskId",     label: "Task ID",     type: "number", location: "path", required: true, placeholder: "5" },
          { name: "status",     label: "Status",      type: "string", location: "body", placeholder: "completed" },
        ],
      },
    ],
  },

  // ── Customer Notes ────────────────────────────────────────────────────────
  {
    id: "customer-notes",
    label: "Customer Notes",
    icon: "🗒️",
    endpoints: [
      {
        id: "get-customer-notes",
        label: "Get Customer Notes",
        method: "GET",
        path: "/api/v3/customers/{id}/notes",
        description: "Retrieve all notes on a customer record.",
        verified: true,
        params: [
          { name: "id", label: "Customer ID", type: "number", location: "path", required: true, placeholder: "12345" },
        ],
      },
      {
        id: "create-customer-note",
        label: "Create Customer Note",
        method: "POST",
        path: "/api/v3/customers/{id}/notes",
        description: "Add a new note to a customer record.",
        verified: true,
        params: [
          { name: "id",      label: "Customer ID", type: "number",   location: "path", required: true, placeholder: "12345" },
          { name: "content", label: "Note",        type: "textarea", location: "body", required: true, placeholder: "Note content" },
        ],
      },
      {
        id: "update-customer-note",
        label: "Update Customer Note",
        method: "PUT",
        path: "/api/v3/customers/{id}/notes/{noteId}",
        description: "Edit an existing note on a customer record.",
        verified: true,
        params: [
          { name: "id",      label: "Customer ID", type: "number",   location: "path", required: true, placeholder: "12345" },
          { name: "noteId",  label: "Note ID",     type: "number",   location: "path", required: true, placeholder: "5" },
          { name: "content", label: "Note",        type: "textarea", location: "body", required: true, placeholder: "Updated note" },
        ],
      },
      {
        id: "delete-customer-note",
        label: "Delete Customer Note",
        method: "DELETE",
        path: "/api/v3/customers/{id}/notes/{noteId}",
        description: "Remove a note from a customer record.",
        verified: true,
        params: [
          { name: "id",     label: "Customer ID", type: "number", location: "path", required: true, placeholder: "12345" },
          { name: "noteId", label: "Note ID",     type: "number", location: "path", required: true, placeholder: "5" },
        ],
      },
    ],
  },

  // ── Surveys ───────────────────────────────────────────────────────────────
  {
    id: "surveys",
    label: "Surveys",
    icon: "📊",
    endpoints: [
      {
        id: "get-surveys",
        label: "Retrieve Surveys",
        method: "POST",
        path: "/api/v3/surveys",
        description: "Retrieve all surveys/deals scoped to your API key. Contains system size (kW), loan product, and deal value — key data for leaderboard scoring.",
        verified: true,
        params: [
          { name: "page",     label: "Page",      type: "number", location: "body", placeholder: "1" },
          { name: "pageSize", label: "Page Size", type: "number", location: "body", placeholder: "25" },
          { name: "status",   label: "Status",    type: "string", location: "body", placeholder: "signed" },
        ],
      },
      {
        id: "get-survey",
        label: "Get Survey by ID",
        method: "GET",
        path: "/api/v3/surveys/{id}",
        description: "Get full details of a survey including system size (kW), equipment, loan product, and rep. Primary source for kW sold leaderboard metric.",
        verified: true,
        params: [
          { name: "id", label: "Survey ID", type: "number", location: "path", required: true, placeholder: "1" },
        ],
      },
      {
        id: "update-survey-status",
        label: "Update Survey Status",
        method: "PUT",
        path: "/api/v3/surveys/{id}/status",
        description: "Update the status of a survey/deal (e.g. mark as signed).",
        verified: true,
        params: [
          { name: "id",     label: "Survey ID", type: "number", location: "path", required: true, placeholder: "1" },
          { name: "status", label: "Status",    type: "string", location: "body", required: true, placeholder: "signed" },
        ],
      },
      {
        id: "add-survey-files",
        label: "Add Files to Survey via URL",
        method: "POST",
        path: "/api/v3/surveys/{id}/add-files-from-url",
        description: "Attach files (e.g. signed documents) to a survey by providing file URLs.",
        verified: true,
        params: [
          { name: "id",  label: "Survey ID", type: "number", location: "path", required: true, placeholder: "1" },
          { name: "url", label: "File URL",  type: "string", location: "body", required: true, placeholder: "https://example.com/file.pdf" },
        ],
      },
    ],
  },

  // ── Change Orders ─────────────────────────────────────────────────────────
  {
    id: "change-orders",
    label: "Change Orders",
    icon: "📋",
    endpoints: [
      {
        id: "get-change-orders",
        label: "Get Change Orders",
        method: "GET",
        path: "/api/v3/change-orders",
        description: "Retrieve change orders. High change order count per rep can signal deal quality issues for leaderboard context.",
        verified: true,
        params: [
          { name: "page",     label: "Page",      type: "number", location: "query", placeholder: "1" },
          { name: "pageSize", label: "Page Size", type: "number", location: "query", placeholder: "25" },
        ],
      },
      {
        id: "create-change-order",
        label: "Create Change Order",
        method: "POST",
        path: "/api/v3/change-orders",
        description: "Create a change order for an existing deal or install.",
        verified: true,
        params: [
          { name: "install_id",  label: "Install ID",  type: "number",   location: "body", required: true, placeholder: "1" },
          { name: "description", label: "Description", type: "textarea", location: "body", required: true, placeholder: "Reason for change" },
        ],
      },
      {
        id: "get-all-change-orders",
        label: "Get All Change Orders (POST)",
        method: "POST",
        path: "/api/v3/change-orders/all",
        description: "Retrieve all change orders using POST body filtering.",
        verified: true,
        params: [
          { name: "page",     label: "Page",      type: "number", location: "body", placeholder: "1" },
          { name: "pageSize", label: "Page Size", type: "number", location: "body", placeholder: "25" },
        ],
      },
      {
        id: "get-change-order",
        label: "Get Change Order by ID",
        method: "GET",
        path: "/api/v3/change-orders/{id}",
        description: "Retrieve a specific change order record.",
        verified: true,
        params: [
          { name: "id", label: "Change Order ID", type: "number", location: "path", required: true, placeholder: "1" },
        ],
      },
      {
        id: "update-change-order",
        label: "Update Change Order",
        method: "PUT",
        path: "/api/v3/change-orders/{id}",
        description: "Update an existing change order.",
        verified: true,
        params: [
          { name: "id",     label: "Change Order ID", type: "number",   location: "path", required: true, placeholder: "1" },
          { name: "status", label: "Status",          type: "string",   location: "body", placeholder: "approved" },
          { name: "notes",  label: "Notes",           type: "textarea", location: "body", placeholder: "Updated notes" },
        ],
      },
      {
        id: "get-install-change-order-data",
        label: "Get Install Change Order Options",
        method: "GET",
        path: "/api/v3/installs/{id}/change-order-data",
        description: "Retrieve the available change order options/data for a specific install.",
        verified: true,
        params: [
          { name: "id", label: "Install ID", type: "number", location: "path", required: true, placeholder: "1" },
        ],
      },
    ],
  },

  // ── Loan Products ─────────────────────────────────────────────────────────
  {
    id: "loan-products",
    label: "Loan Products",
    icon: "💰",
    endpoints: [
      {
        id: "get-loan-products",
        label: "Get Loan Products",
        method: "GET",
        path: "/api/v3/loan-products",
        description: "List available financing / loan products. Used to enrich deal data with finance type for leaderboard segmentation.",
        verified: true,
        params: [],
      },
    ],
  },

  // ── Equipment ─────────────────────────────────────────────────────────────
  {
    id: "equipment",
    label: "Equipment",
    icon: "⚡",
    endpoints: [
      {
        id: "get-panels",
        label: "Get Panels",
        method: "GET",
        path: "/api/v3/company/panels",
        description: "Retrieve solar panel models available in your company catalog.",
        verified: true,
        params: [],
      },
      {
        id: "get-inverters",
        label: "Get Inverters",
        method: "GET",
        path: "/api/v3/company/inverters",
        description: "Retrieve inverter models available in your company catalog.",
        verified: true,
        params: [],
      },
      {
        id: "get-products",
        label: "Get Company Products",
        method: "GET",
        path: "/api/v3/company/products",
        description: "Retrieve all company products (panels, inverters, batteries, etc.).",
        verified: true,
        params: [],
      },
    ],
  },

  // ── Utilities ─────────────────────────────────────────────────────────────
  {
    id: "utilities",
    label: "Utilities",
    icon: "🔧",
    endpoints: [
      {
        id: "get-utilities",
        label: "Get Utilities",
        method: "GET",
        path: "/api/v3/utilities",
        description: "List utility providers available in Enerflo. Used to map customer utility to territory in Terros.",
        verified: true,
        params: [],
      },
    ],
  },

  // ── Companies ─────────────────────────────────────────────────────────────
  {
    id: "companies",
    label: "Companies",
    icon: "🏢",
    endpoints: [
      {
        id: "get-company",
        label: "Get Company by ID",
        method: "GET",
        path: "/api/v3/companies/{id}",
        description: "Retrieve a specific company's details.",
        verified: true,
        params: [
          { name: "id", label: "Company ID", type: "number", location: "path", required: true, placeholder: "1" },
        ],
      },
      {
        id: "get-commission-logs",
        label: "Get Commission Logs",
        method: "GET",
        path: "/api/v3/company/commissions/logs",
        description: "Retrieve commission payout logs. Useful for reconciling Enerflo commission data with Sequifi payroll.",
        verified: true,
        params: [],
      },
      {
        id: "get-market-zipcodes",
        label: "Get Market Zip Codes",
        method: "GET",
        path: "/api/v3/company/markets/zipcode-list",
        description: "Retrieve the list of zip codes per market/territory. Used to map customer addresses to Terros territories.",
        verified: true,
        params: [],
      },
    ],
  },

  // ── Offices ───────────────────────────────────────────────────────────────
  {
    id: "offices",
    label: "Offices",
    icon: "🏠",
    endpoints: [
      {
        id: "get-offices",
        label: "Get All Offices",
        method: "GET",
        path: "/api/v3/offices",
        description: "List all offices in your organization. Used to retrieve office_id for user creation and territory tagging.",
        verified: true,
        params: [],
      },
      {
        id: "get-office",
        label: "Get Office by ID",
        method: "GET",
        path: "/api/v3/offices/{id}",
        description: "Retrieve a specific office by its Enerflo office ID.",
        verified: true,
        params: [
          { name: "id", label: "Office ID", type: "string", location: "path", required: true, placeholder: "abc123" },
        ],
      },
    ],
  },

  // ── Lead Gen ─────────────────────────────────────────────────────────────
  {
    id: "lead-gen",
    label: "Lead Gen",
    icon: "🎯",
    endpoints: [
      {
        id: "create-lead",
        label: "Add Customer / Lead",
        method: "POST",
        path: "/api/v1/partner/action/lead/add",
        description: "Push a new homeowner lead into Enerflo from a door knock, web form, or external CRM. Can also schedule an appointment and attach survey data in the same request.",
        verified: true,
        params: [
          { name: "first_name",            label: "First Name",                  type: "string",   location: "body", required: true, placeholder: "Jane" },
          { name: "last_name",             label: "Last Name",                   type: "string",   location: "body", required: true, placeholder: "Smith" },
          { name: "address",               label: "Street Address",              type: "string",   location: "body", required: true, placeholder: "123 Solar Ave" },
          { name: "city",                  label: "City",                        type: "string",   location: "body", required: true, placeholder: "Phoenix" },
          { name: "state",                 label: "State (2-char)",              type: "string",   location: "body", required: true, placeholder: "AZ" },
          { name: "zip",                   label: "ZIP",                         type: "string",   location: "body", required: true, placeholder: "85001" },
          { name: "email",                 label: "Email",                       type: "email",    location: "body", placeholder: "jane@example.com" },
          { name: "mobile",                label: "Mobile Phone",                type: "tel",      location: "body", placeholder: "+1 555 000 0000" },
          { name: "lead_source",           label: "Lead Source",                 type: "string",   location: "body", placeholder: "door-knock" },
          { name: "lead_status",           label: "Initial Lead Status",         type: "string",   location: "body", placeholder: "New" },
          { name: "assign_to_email",       label: "Assign to Sales Rep (email)", type: "email",    location: "body", placeholder: "rep@company.com" },
          { name: "setter_email",          label: "Setter Email",                type: "email",    location: "body", placeholder: "setter@company.com" },
          { name: "office_name",           label: "Office Name",                 type: "string",   location: "body", placeholder: "Phoenix North" },
          { name: "integration_record_id", label: "External CRM ID",            type: "string",   location: "body", placeholder: "terros-knock-001" },
          { name: "add_note",              label: "Note",                        type: "textarea", location: "body", placeholder: "Shown on the customer record in Enerflo" },
          { name: "createDeal",            label: "Create Deal (Deal Type ID)",  type: "string",   location: "body", placeholder: "Provided by Enerflo Build Team" },
        ],
      },
    ],
  },

  // ── V1 Lookups ────────────────────────────────────────────────────────────
  {
    id: "lookups",
    label: "Lookups",
    icon: "🔍",
    endpoints: [
      {
        id: "lookup-customer-by-external-id",
        label: "Lookup Customer by External ID",
        method: "GET",
        path: "/api/v1/lookups/customer",
        description: "Find an Enerflo customer using an external CRM ID (e.g. Terros knock ID).",
        verified: true,
        params: [
          { name: "external_id", label: "External ID", type: "string", location: "query", required: true, placeholder: "terros-knock-001" },
        ],
      },
      {
        id: "lookup-user-by-external-id",
        label: "Lookup User by External ID",
        method: "GET",
        path: "/api/v1/lookups/user",
        description: "Find an Enerflo user using an external HR/onboarding ID (e.g. Sequifi employee ID).",
        verified: true,
        params: [
          { name: "external_id", label: "External ID", type: "string", location: "query", required: true, placeholder: "sequifi-emp-001" },
        ],
      },
    ],
  },

  // ── Webhook Management ────────────────────────────────────────────────────
  {
    id: "webhooks",
    label: "Webhooks",
    icon: "🔗",
    endpoints: [
      {
        id: "get-webhooks",
        label: "Get Webhook Subscriptions",
        method: "GET",
        path: "/api/v1/webhooks",
        description: "List all active webhook subscriptions for your account.",
        verified: true,
        params: [],
      },
      {
        id: "create-webhook",
        label: "Create Webhook",
        method: "POST",
        path: "/api/v1/webhooks",
        description: "Subscribe to an Enerflo event and receive it at your middleware endpoint URL.",
        verified: true,
        params: [
          { name: "url",    label: "Endpoint URL", type: "string",   location: "body", required: true, placeholder: "https://your-domain.com/api/webhooks/enerflo" },
          { name: "event",  label: "Event Name",   type: "string",   location: "body", required: true, placeholder: "customer.created" },
          { name: "secret", label: "Secret",       type: "password", location: "body", placeholder: "HMAC signing secret" },
        ],
      },
      {
        id: "delete-webhook",
        label: "Delete Webhook",
        method: "DELETE",
        path: "/api/v1/webhooks/{id}",
        description: "Remove a webhook subscription by its ID.",
        verified: true,
        params: [
          { name: "id", label: "Webhook ID", type: "number", location: "path", required: true, placeholder: "1" },
        ],
      },
    ],
  },
];
