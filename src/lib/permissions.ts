export const DEFAULT_AGENT_PERMISSIONS: Record<string, boolean> = {
  send_messages: true,
  read_chats: true,
  access_contacts: true,
  manage_contacts: true,
  access_groups: true,
  send_group_messages: true,
  read_group_chats: true,
  view_message_history: true,
  make_calls: true,
  make_whatsapp_calls: true,
  gmail: true,
  calendar: true,
  tasks: true,
  drive: true,
  youtube: true,
  generate_image: true,
  create_document: true,
  playwright_action: true,
  search_flights: true,
  book_flight: true,
  validate_vat_number: true,
  check_train_route: true,
  calculate_registration_tax: true,
  check_tax_deadlines: true,
  generate_peppol_invoice_xml: true,
  barcode_scanner: true,
};

export function createDefaultAgentPermissions(): Record<string, boolean> {
  return { ...DEFAULT_AGENT_PERMISSIONS };
}
