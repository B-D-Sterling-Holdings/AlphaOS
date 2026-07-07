'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Mail,
  MapPin,
  Phone,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import ConfirmModal from '@/components/ConfirmModal';
import Toast from '@/components/Toast';

const EMPTY_FORM = {
  name: '',
  city: '',
  company: '',
  contactType: 'email',
  email: '',
  notes: [],
};

const cleanNote = (note) => note.trim().replace(/^[-*]\s+/, '').trim();
const parseNotes = (notes = '') => notes.split(/\r?\n/).map(cleanNote).filter(Boolean);
const serializeNotes = (notes = []) => notes.map(cleanNote).filter(Boolean).join('\n');

const lastName = (contact) => (contact.name || '').trim().split(/\s+/).at(-1)?.toLowerCase() || '';
const sortByLastName = (items) =>
  [...items].sort((a, b) => lastName(a).localeCompare(lastName(b)) || (a.name || '').localeCompare(b.name || ''));

const looksLikePhone = (value = '') => {
  if (!value || value.includes('@')) return false;
  return value.replace(/\D/g, '').length >= 7;
};

const getContactType = (contact = {}) => {
  if (contact.contact_method === 'phone' || contact.phone || looksLikePhone(contact.contact_value)) return 'phone';
  return 'email';
};

const contactLabel = (contact) => {
  if (getContactType(contact) === 'phone') return 'Phone';
  return contact.contact_value || 'No email';
};

const toForm = (contact) => {
  if (!contact) return EMPTY_FORM;
  const contactType = getContactType(contact);
  return {
    name: contact.name || '',
    city: contact.city || '',
    company: contact.company || '',
    contactType,
    email: contactType === 'email' ? contact.contact_value || '' : '',
    notes: parseNotes(contact.notes),
  };
};

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, autoFocus, type = 'text' }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
    />
  );
}

function ContactDrawer({
  mode,
  contact,
  form,
  setForm,
  saving,
  onClose,
  onSave,
  onDelete,
}) {
  const title = mode === 'create' ? 'Add Contact' : 'Contact Card';
  const noteRows = form.notes.length ? form.notes : [''];

  const updateNote = (index, value) => {
    const next = [...noteRows];
    next[index] = value;
    setForm({ ...form, notes: next });
  };

  const deleteNote = (index) => {
    setForm({ ...form, notes: noteRows.filter((_, i) => i !== index).map(cleanNote).filter(Boolean) });
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[440px] flex-col border-l border-gray-200 bg-white shadow-2xl">
      <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">{title}</p>
          <h2 className="mt-1 truncate text-lg font-bold text-gray-950">
            {form.name || (mode === 'create' ? 'New relationship' : contact?.name)}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          aria-label="Close contact card"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <Field label="Name">
          <TextInput
            value={form.name}
            onChange={(name) => setForm({ ...form, name })}
            placeholder="Name"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="City">
            <TextInput value={form.city} onChange={(city) => setForm({ ...form, city })} placeholder="City" />
          </Field>
          <Field label="Firm">
            <TextInput value={form.company} onChange={(company) => setForm({ ...form, company })} placeholder="Firm" />
          </Field>
        </div>

        <Field label="Contact Type">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1">
            {[
              { key: 'email', label: 'Email', icon: Mail },
              { key: 'phone', label: 'Phone', icon: Phone },
            ].map((option) => {
              const Icon = option.icon;
              const active = form.contactType === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setForm({ ...form, contactType: option.key, email: option.key === 'phone' ? '' : form.email })}
                  className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${
                    active ? 'bg-white text-gray-950 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  <Icon size={14} />
                  {option.label}
                </button>
              );
            })}
          </div>
        </Field>

        {form.contactType === 'email' && (
          <Field label="Email">
            <TextInput
              type="email"
              value={form.email}
              onChange={(email) => setForm({ ...form, email })}
              placeholder="email@example.com"
            />
          </Field>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Comments</span>
            <button
              type="button"
              onClick={() => setForm({ ...form, notes: [...noteRows.map(cleanNote).filter(Boolean), ''] })}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
            >
              <Plus size={12} />
              Add
            </button>
          </div>

          <div className="space-y-2">
            {noteRows.map((note, index) => (
              <div key={index} className="flex items-start gap-2">
                <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
                <textarea
                  value={note}
                  onChange={(event) => updateNote(index, event.target.value)}
                  placeholder="Add a comment"
                  rows={2}
                  className="min-h-10 flex-1 resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
                />
                <button
                  type="button"
                  onClick={() => deleteNote(index)}
                  className="rounded-lg p-2 text-gray-300 transition hover:bg-red-50 hover:text-red-500"
                  aria-label="Delete comment"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-4">
        {mode === 'edit' ? (
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-red-500 transition hover:bg-red-50"
          >
            <Trash2 size={15} />
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !form.name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={15} />
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </aside>
  );
}

export default function RelationshipsPage() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState({ mode: null, id: null });
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const response = await fetch('/api/contacts');
        if (!response.ok) throw new Error('Failed to load contacts');
        const data = await response.json();
        if (mounted && Array.isArray(data)) setContacts(sortByLastName(data));
      } catch {
        if (mounted) setToast({ message: 'Failed to load contacts', type: 'error' });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === drawer.id),
    [contacts, drawer.id],
  );

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const sorted = sortByLastName(contacts);
    if (!query) return sorted;

    return sorted.filter((contact) => {
      const notes = parseNotes(contact.notes).join(' ');
      return [
        contact.name,
        contact.city,
        contact.company,
        contactLabel(contact),
        notes,
      ].some((value) => (value || '').toLowerCase().includes(query));
    });
  }, [contacts, search]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setDrawer({ mode: 'create', id: null });
  };

  const openEdit = (contact) => {
    setForm(toForm(contact));
    setDrawer({ mode: 'edit', id: contact.id });
  };

  const closeDrawer = () => {
    setDrawer({ mode: null, id: null });
    setForm(EMPTY_FORM);
  };

  const applySavedContact = (saved) => {
    setContacts((previous) => sortByLastName([saved, ...previous.filter((contact) => contact.id !== saved.id)]));
    setDrawer({ mode: 'edit', id: saved.id });
    setForm(toForm(saved));
  };

  const saveContact = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      city: form.city.trim(),
      company: form.company.trim(),
      contact_method: form.contactType,
      contact_value: form.contactType === 'email' ? form.email.trim() : '',
      phone: '',
      notes: serializeNotes(form.notes),
    };

    try {
      const isCreate = drawer.mode === 'create';
      // Guard edits on the version we loaded (optimistic concurrency).
      const baseVersion = isCreate ? undefined : contacts.find((c) => c.id === drawer.id)?.version;
      const response = await fetch('/api/contacts', {
        method: isCreate ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isCreate ? payload : { id: drawer.id, ...payload, baseVersion }),
      });
      const saved = await response.json().catch(() => ({}));
      if (response.status === 409 && saved.conflict) {
        // Someone edited this contact first — adopt their version, don't clobber it.
        if (saved.current) applySavedContact(saved.current);
        setToast({ message: 'This contact was changed elsewhere — reloaded the latest. Re-apply your edit.', type: 'info' });
        return;
      }
      if (!response.ok) throw new Error('Save failed');
      applySavedContact(saved);
      setToast({ message: isCreate ? 'Contact added' : 'Contact updated', type: 'success' });
    } catch {
      setToast({ message: 'Failed to save contact', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const deleteContact = async (id) => {
    try {
      const response = await fetch(`/api/contacts?id=${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
      setContacts((previous) => previous.filter((contact) => contact.id !== id));
      closeDrawer();
      setToast({ message: 'Contact deleted', type: 'success' });
    } catch {
      setToast({ message: 'Failed to delete contact', type: 'error' });
    }
  };

  const requestDelete = () => {
    if (!selectedContact) return;
    setConfirm({
      title: 'Delete Contact',
      message: `Delete ${selectedContact.name}? This cannot be undone.`,
      onCancel: () => setConfirm(null),
      onConfirm: async () => {
        const id = selectedContact.id;
        setConfirm(null);
        await deleteContact(id);
      },
    });
  };

  const drawerOpen = Boolean(drawer.mode);

  return (
    <div className="min-h-[calc(100vh-80px)] px-6 py-2 lg:px-12">
      <div className={`transition-[padding] duration-200 ${drawerOpen ? 'xl:pr-[460px]' : ''}`}>
        <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Users size={18} className="text-emerald-600" />
            <h1 className="text-lg font-bold text-gray-950">Relationships</h1>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
              {contacts.length}
            </span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search relationships"
                className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-9 text-sm text-gray-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 sm:w-72"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  aria-label="Clear search"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <Plus size={15} />
              Add Contact
            </button>
          </div>
        </header>

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {['Name', 'City', 'Firm', 'Contact', 'Comments'].map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                      Loading contacts...
                    </td>
                  </tr>
                )}

                {!loading && filteredContacts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">
                      {search ? 'No contacts match your search.' : 'No contacts yet.'}
                    </td>
                  </tr>
                )}

                {!loading && filteredContacts.map((contact) => {
                  const notes = parseNotes(contact.notes);
                  const latestNote = notes.at(-1);
                  const active = contact.id === drawer.id;

                  return (
                    <tr
                      key={contact.id}
                      onClick={() => openEdit(contact)}
                      className={`cursor-pointer transition hover:bg-emerald-50/50 ${active ? 'bg-emerald-50' : 'bg-white'}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-bold text-gray-600">
                            {(contact.name || '?').slice(0, 1)}
                          </div>
                          <span className="text-sm font-semibold text-gray-950">{contact.name || 'Untitled'}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin size={13} className="text-gray-300" />
                          {contact.city || '—'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        <span className="inline-flex items-center gap-1.5">
                          <Building2 size={13} className="text-gray-300" />
                          {contact.company || '—'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                        {contactLabel(contact)}
                      </td>
                      <td className="min-w-[280px] px-4 py-3 text-sm text-gray-600">
                        {latestNote ? (
                          <div className="flex items-center gap-2">
                            <span className="truncate">{latestNote}</span>
                            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                              {notes.length}
                            </span>
                          </div>
                        ) : (
                          <span className="text-gray-300">No comments</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {drawerOpen && (
        <ContactDrawer
          mode={drawer.mode}
          contact={selectedContact}
          form={form}
          setForm={setForm}
          saving={saving}
          onClose={closeDrawer}
          onSave={saveContact}
          onDelete={requestDelete}
        />
      )}

      {confirm && <ConfirmModal {...confirm} />}
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
