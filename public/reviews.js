const reviewEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[character]));

const reviewDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
};

function renderReviewCards(container, reviews) {
  if (!reviews.length) {
    container.innerHTML = '<p class="muted">No approved reviews yet. Be the first to share your experience.</p>';
    return;
  }
  container.innerHTML = reviews.map((review) => `
    <article class="review-card">
      <div class="rating" aria-label="${review.rating} out of 5 stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
      <p>${reviewEscape(review.description)}</p>
      <strong>${reviewEscape(review.name)}</strong>
      <small>${reviewEscape(reviewDate(review.created_at))}</small>
    </article>
  `).join('');
}

function bindReviewForm(form) {
  let rating = 0;
  const message = form.querySelector('[data-review-message]');
  const buttons = Array.from(form.querySelectorAll('[data-review-rating]'));
  const updateRating = (value) => {
    rating = value;
    buttons.forEach((button) => {
      const selected = Number(button.dataset.reviewRating) <= rating;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', Number(button.dataset.reviewRating) === rating ? 'true' : 'false');
    });
  };
  buttons.forEach((button) => button.addEventListener('click', () => updateRating(Number(button.dataset.reviewRating))));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const response = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ rating, description: form.elements.description.value })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not submit your review.');
      form.reset();
      updateRating(0);
      message.textContent = result.message;
      message.classList.add('success');
    } catch (error) {
      message.textContent = error.message;
      message.classList.remove('success');
    } finally {
      submit.disabled = false;
    }
  });
}

async function loadPublicReviews() {
  const container = document.getElementById('publicReviews');
  const submission = document.getElementById('reviewSubmission');
  if (!container || !submission) return;
  try {
    const [reviewsResponse, accountResponse] = await Promise.all([
      fetch('/api/reviews', { cache: 'no-store' }),
      fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
    ]);
    if (!reviewsResponse.ok || !accountResponse.ok) throw new Error('Could not load reviews. Refresh the page to try again.');
    const reviews = await reviewsResponse.json();
    const account = await accountResponse.json();
    renderReviewCards(container, Array.isArray(reviews) ? reviews : []);
    if (account.authenticated) {
      submission.innerHTML = `
        <p class="eyebrow">SHARE YOUR EXPERIENCE</p>
        <h2>Your review</h2>
        <p class="muted">Your review will appear publicly only after approval by our team.</p>
        <form id="publicReviewForm" class="review-form">
          <label>Your rating
            <div class="review-star-picker" role="radiogroup" aria-label="Choose a rating from 1 to 5 stars">
              ${[1, 2, 3, 4, 5].map((value) => `<button type="button" class="review-star" data-review-rating="${value}" role="radio" aria-checked="false" aria-label="${value} star${value === 1 ? '' : 's'}">★</button>`).join('')}
            </div>
          </label>
          <label>Review<textarea name="description" rows="4" maxlength="2000" required placeholder="Tell us about the product or your shopping experience"></textarea></label>
          <button class="button button-dark" type="submit">Submit review</button>
          <p class="auth-message" data-review-message role="status" aria-live="polite"></p>
        </form>`;
      bindReviewForm(document.getElementById('publicReviewForm'));
    } else {
      submission.innerHTML = `
        <p class="eyebrow">SHARE YOUR EXPERIENCE</p>
        <h2>Your review</h2>
        <p class="muted">Sign in to share your experience. Every review is checked by our team before it appears here.</p>
        <a class="button button-outline" href="/login">Sign in to write a review</a>`;
    }
  } catch (error) {
    container.innerHTML = `<p class="muted">${reviewEscape(error.message)}</p>`;
    submission.querySelector('.muted').textContent = error.message;
  }
}

document.addEventListener('DOMContentLoaded', loadPublicReviews);
