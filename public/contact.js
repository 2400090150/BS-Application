async function loadContactDetails() {
  try {
    const response = await fetch('/api/contact', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load store contact details.');
    const contact = await response.json();
    const phone = document.getElementById('contactPhone');
    const email = document.getElementById('contactEmail');
    const address = document.getElementById('contactAddress');
    if (phone && contact.phone) {
      phone.textContent = contact.phone;
      phone.href = `tel:${contact.phone.replace(/[^\d+]/g, '')}`;
    }
    if (email && contact.email) {
      email.textContent = contact.email;
      email.href = `mailto:${contact.email}`;
    }
    if (address && contact.address) address.textContent = contact.address;
  } catch (error) {
    console.error(error.message);
  }
}

loadContactDetails();