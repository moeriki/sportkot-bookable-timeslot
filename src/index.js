// ==UserScript==
// @name         Sportkot Automator
// @namespace    https://usc.kuleuven.cloud/products/bookable-product-schedule
// @version      2025-11-05
// @description  Automates booking on Sportkot Bookable Timeslots
// @author       Dieter Luypaert
// @match        https://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
	'use strict';

	// ===== CONFIGURATION =====
	const CONFIG = {
		// Time when the system becomes semi-active (can prepare booking)
		PREP_TIME: { hour: 8, minute: 59 },
		// Time when actual booking can be executed
		BOOKING_TIME: { hour: 9, minute: 0 },
		// Selectors for page elements
		SELECTORS: {
			daySelectorButtons: 'day-selector .btn[data-test-id-day-selector]',
			bookableSlotList: 'bookable-slot-list',
			bookableSlot: 'bookable-slot-list div[data-test-id="bookable-slot-list"]',
			slotTime: '[data-test-id="bookable-slot-start-time"]',
			slotTitle: '[data-test-id="bookable-slot-linked-product-description"]',
			slotButton: '.btn',
			modalProductSelect: 'product-select-input input',
			modalBookButton: '.btn[data-test-id=details-book-button]',
		},
	};

	/**
	 * @typedef {object} BookableSlotDetails
	 * @property {HTMLButtonElement} button
	 * @property {string} time
	 * @property {string} title
	 */

	/**
	 * @typedef {object} BookableSlotModalDetails
	 * @property {HTMLButtonElement} button
	 * @property {HTMLInputElement} selectInput
	 */

	/**
	 * @param {HTMLElement} bookableSlotElement
	 * @return {BookableSlotDetails | undefined}
	 */
	function findBookableSlotDetails(bookableSlotElement) {
		const button = bookableSlotElement.querySelector(
			CONFIG.SELECTORS.slotButton,
		);
		const time = bookableSlotElement
			.querySelector(CONFIG.SELECTORS.slotTime)
			?.textContent.trim();
		const title = bookableSlotElement
			.querySelector(CONFIG.SELECTORS.slotTitle)
			?.textContent.trim();
		if (!button || !time || !title) {
			console.log('Missing element:', { button, time, title });
			return;
		}
		return { button, time, title };
	}

	/**
	 * @param {HTMLElement} root
	 */
	function findProductModalDetail() {
		const selectInput = document.querySelector(
			CONFIG.SELECTORS.modalProductSelect,
		);
		const button = document.querySelector(CONFIG.SELECTORS.modalBookButton);
		if (!selectInput || !button) {
			console.log('Missing elements:', { selectInput, button });
			return;
		}
		return { selectInput, button };
	}

	// ===== STATE MANAGEMENT =====
	const state = {
		selectedSlot: null,
		availableSlots: [],
		status: 'idle', // 'idle', 'preparing', 'ready', 'booking', 'success', 'error'
		prepTimer: null,
		bookingTimer: null,
		scanInterval: null,
		hasFoundSlots: false,
	};

	// ===== UI OVERLAY =====
	function createOverlay() {
		const overlay = document.createElement('div');
		overlay.id = 'sportkot-automator-overlay';
		overlay.innerHTML = `
			<style>
				#sportkot-automator-overlay {
					position: fixed;
					bottom: 20px;
					right: 20px;
					width: 350px;
					max-height: 600px;
					background: white;
					border: 2px solid #333;
					border-radius: 8px;
					box-shadow: 0 4px 12px rgba(0,0,0,0.3);
					z-index: 10000;
					font-family: system-ui, -apple-system, sans-serif;
					display: flex;
					flex-direction: column;
				}
				#sportkot-automator-overlay * {
					box-sizing: border-box;
				}
				.sa-header {
					background: #333;
					color: white;
					padding: 12px;
					font-weight: bold;
					display: flex;
					justify-content: space-between;
					align-items: center;
					border-radius: 6px 6px 0 0;
				}
				.sa-status {
					padding: 12px;
					border-bottom: 1px solid #ddd;
					font-size: 13px;
				}
				.sa-status-idle { background: #f0f0f0; }
				.sa-status-preparing { background: #fff3cd; }
				.sa-status-ready { background: #d4edda; }
				.sa-status-booking { background: #cce5ff; }
				.sa-status-success { background: #d4edda; }
				.sa-status-error { background: #f8d7da; }
				.sa-slots {
					flex: 1;
					overflow-y: auto;
					padding: 8px;
				}
				.sa-slot {
					border: 1px solid #ddd;
					border-radius: 4px;
					padding: 10px;
					margin-bottom: 8px;
					cursor: pointer;
					transition: all 0.2s;
				}
				.sa-slot:hover {
					background: #f8f9fa;
					border-color: #007bff;
				}
				.sa-slot.selected {
					background: #e7f3ff;
					border-color: #007bff;
					border-width: 2px;
				}
				.sa-slot-time {
					font-weight: bold;
					font-size: 16px;
					color: #007bff;
				}
				.sa-slot-title {
					font-size: 13px;
					color: #666;
					margin-top: 4px;
				}
				.sa-empty {
					padding: 20px;
					text-align: center;
					color: #999;
					font-style: italic;
				}
				.sa-footer {
					padding: 12px;
					border-top: 1px solid #ddd;
					font-size: 11px;
					color: #666;
				}
			</style>
			<div class="sa-header">
				<span>🎯 Sportkot Automator</span>
			</div>
			<div class="sa-status sa-status-idle" id="sa-status">
				Status: Waiting for selection...
			</div>
			<div class="sa-slots" id="sa-slots">
				<div class="sa-empty">No slots detected. Select a day to see available slots.</div>
			</div>
			<div class="sa-footer">
				Prep: ${CONFIG.PREP_TIME.hour}:${String(CONFIG.PREP_TIME.minute).padStart(2, '0')} |
				Book: ${CONFIG.BOOKING_TIME.hour}:${String(CONFIG.BOOKING_TIME.minute).padStart(2, '0')}
			</div>
		`;

		document.body.appendChild(overlay);

		return overlay;
	}

	function updateStatus(status, message) {
		state.status = status;
		const statusEl = document.getElementById('sa-status');
		if (statusEl) {
			statusEl.className = `sa-status sa-status-${status}`;
			statusEl.textContent = message;
		}
	}

	function renderSlots() {
		const slotsContainer = document.getElementById('sa-slots');
		if (!slotsContainer) return;

		if (state.availableSlots.length === 0) {
			slotsContainer.innerHTML =
				'<div class="sa-empty">No slots detected. Select a day to see available slots.</div>';
			return;
		}

		slotsContainer.innerHTML = state.availableSlots
			.map(
				(slot, index) => `
			<div class="sa-slot ${state.selectedSlot === slot ? 'selected' : ''}" data-slot-index="${index}">
				<div class="sa-slot-time">${slot.time}</div>
				<div class="sa-slot-title">${slot.title}</div>
			</div>
		`,
			)
			.join('');

		// Add click handlers
		slotsContainer.querySelectorAll('.sa-slot').forEach((el) => {
			el.addEventListener('click', () => {
				const index = parseInt(el.dataset.slotIndex);
				selectSlot(state.availableSlots[index]);
			});
		});
	}

	function selectSlot(slot) {
		state.selectedSlot = slot;
		renderSlots();
		updateStatus('idle', `Selected: ${slot.time} - ${slot.title}`);
		scheduleBooking();
	}

	// ===== SLOT DETECTION =====
	function scanForSlots() {
		const slotElements = document.querySelectorAll(
			CONFIG.SELECTORS.bookableSlot,
		);
		const slots = [];

		slotElements.forEach((element) => {
			const details = findBookableSlotDetails(element);
			if (details) {
				slots.push(details);
			}
		});

		state.availableSlots = slots;
		renderSlots();

		if (slots.length > 0) {
			// Found slots! Stop the interval scanning
			if (state.scanInterval) {
				clearInterval(state.scanInterval);
				state.scanInterval = null;
			}
			state.hasFoundSlots = true;

			updateStatus(
				'idle',
				`Found ${slots.length} available slot${slots.length > 1 ? 's' : ''}. Select one to begin.`,
			);
		} else {
			// Only update status if we haven't found slots yet
			if (!state.hasFoundSlots) {
				updateStatus('idle', 'Scanning for slots...');
			}
		}
	}

	function setupSlotMonitoring() {
		// Start periodic scanning until we find slots
		updateStatus('idle', 'Scanning for slots...');

		// Initial immediate scan
		scanForSlots();

		// Keep scanning every 2 seconds until we find slots
		state.scanInterval = setInterval(() => {
			if (!state.hasFoundSlots) {
				console.log('Periodic scan for slots...');
				scanForSlots();
			}
		}, 2000);

		// Monitor for changes to the slot list
		const slotListContainer = document.querySelector(
			CONFIG.SELECTORS.bookableSlotList,
		);

		if (slotListContainer) {
			const observer = new MutationObserver(() => {
				console.log('Slot list changed, rescanning...');
				// Reset the found flag when content changes
				state.hasFoundSlots = false;
				scanForSlots();

				// Restart interval scanning if needed
				if (!state.scanInterval && !state.hasFoundSlots) {
					state.scanInterval = setInterval(() => {
						if (!state.hasFoundSlots) {
							scanForSlots();
						}
					}, 2000);
				}
			});

			observer.observe(slotListContainer, {
				childList: true,
				subtree: true,
			});
		}

		// Also monitor day selector clicks
		const daySelectorButtons = document.querySelectorAll(
			CONFIG.SELECTORS.daySelectorButtons,
		);

		daySelectorButtons.forEach((button) => {
			button.addEventListener('click', () => {
				console.log(
					'Day selector clicked, clearing selection and rescanning...',
				);
				// Clear selection and reset state
				state.selectedSlot = null;
				state.hasFoundSlots = false;
				state.availableSlots = [];
				renderSlots();

				// Clear any scheduled bookings
				if (state.prepTimer) clearTimeout(state.prepTimer);
				if (state.bookingTimer) clearTimeout(state.bookingTimer);

				updateStatus('idle', 'Scanning for slots...');

				// Start scanning again
				if (!state.scanInterval) {
					state.scanInterval = setInterval(() => {
						if (!state.hasFoundSlots) {
							scanForSlots();
						}
					}, 2000);
				}

				setTimeout(scanForSlots, 500);
			});
		});
	}

	// ===== TIME-BASED SCHEDULING =====
	function getTimeUntil(targetHour, targetMinute) {
		const now = new Date();
		const target = new Date();
		target.setHours(targetHour, targetMinute, 0, 0);

		// If target time has passed today, schedule for tomorrow
		if (target <= now) {
			target.setDate(target.getDate() + 1);
		}

		return target.getTime() - now.getTime();
	}

	function scheduleBooking() {
		if (!state.selectedSlot) {
			console.log('No slot selected, cannot schedule');
			return;
		}

		// Clear any existing timers
		if (state.prepTimer) clearTimeout(state.prepTimer);
		if (state.bookingTimer) clearTimeout(state.bookingTimer);

		const prepDelay = getTimeUntil(
			CONFIG.PREP_TIME.hour,
			CONFIG.PREP_TIME.minute,
		);
		const bookingDelay = getTimeUntil(
			CONFIG.BOOKING_TIME.hour,
			CONFIG.BOOKING_TIME.minute,
		);

		const prepDate = new Date(Date.now() + prepDelay);
		const bookingDate = new Date(Date.now() + bookingDelay);

		updateStatus(
			'idle',
			`Scheduled: Prep at ${prepDate.toLocaleTimeString()}, Book at ${bookingDate.toLocaleTimeString()}`,
		);

		// Schedule preparation
		state.prepTimer = setTimeout(() => {
			prepareBooking();
		}, prepDelay);

		// Schedule actual booking
		state.bookingTimer = setTimeout(() => {
			executeBooking();
		}, bookingDelay);

		console.log(
			`Booking scheduled - Prep in ${Math.round(prepDelay / 1000)}s, Book in ${Math.round(bookingDelay / 1000)}s`,
		);
	}

	function prepareBooking() {
		if (!state.selectedSlot) {
			updateStatus('error', 'No slot selected!');
			return;
		}

		updateStatus('preparing', 'Opening modal and preparing booking...');

		// Click the reserve button to open the modal
		state.selectedSlot.button.click();

		// Wait for modal to appear, then fill it out
		setTimeout(() => {
			const modalDetails = findProductModalDetail();
			if (!modalDetails) {
				updateStatus(
					'error',
					'Could not find modal elements. Please check manually.',
				);
				return;
			}

			// Focus the select input (this may trigger any necessary validation)
			modalDetails.selectInput.focus();

			updateStatus(
				'ready',
				`Ready to book ${state.selectedSlot.time}. Waiting for ${CONFIG.BOOKING_TIME.hour}:${String(CONFIG.BOOKING_TIME.minute).padStart(2, '0')}...`,
			);
		}, 1000);
	}

	function executeBooking() {
		if (!state.selectedSlot) {
			updateStatus('error', 'No slot selected!');
			return;
		}

		updateStatus('booking', 'Executing booking NOW!');

		const modalDetails = findProductModalDetail();
		if (!modalDetails) {
			updateStatus(
				'error',
				'Could not find modal book button. Please complete manually!',
			);
			return;
		}

		// Click the booking button
		modalDetails.button.click();

		// Give feedback
		setTimeout(() => {
			updateStatus(
				'success',
				`Booking executed for ${state.selectedSlot.time}! Check if successful.`,
			);
		}, 500);
	}

	// ===== INITIALIZATION =====
	function init() {
		console.log('Sportkot Automator: Initializing...');

		// Wait for page to be ready
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', init);
			return;
		}

		// Create the overlay UI
		createOverlay();

		// Setup monitoring for slots
		setupSlotMonitoring();

		console.log('Sportkot Automator: Ready!');
	}

	// Start the script
	init();
})();
