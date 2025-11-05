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
		countdownInterval: null,
		prepTime: null,
		bookingTime: null,
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
					width: 500px;
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
					display: grid;
					gap: 8px;
					align-content: start;
				}
				.sa-slots.one-column {
					grid-template-columns: 1fr;
				}
				.sa-slots.two-columns {
					grid-template-columns: 1fr 1fr;
				}
				.sa-slot {
					border: 1px solid #ddd;
					border-radius: 4px;
					padding: 10px;
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
				.sa-time-header {
					font-weight: bold;
					font-size: 14px;
					color: #333;
					padding: 8px;
					background: #f8f9fa;
					border-radius: 4px;
					text-align: center;
					grid-column: 1 / -1;
				}
				.sa-slot-empty {
					border: 1px dashed #ddd;
					border-radius: 4px;
					padding: 10px;
					background: #fafafa;
					opacity: 0.5;
				}
				.sa-empty {
					padding: 20px;
					text-align: center;
					color: #999;
					font-style: italic;
					grid-column: 1 / -1;
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
				Preparation: ${CONFIG.PREP_TIME.hour}:${String(CONFIG.PREP_TIME.minute).padStart(2, '0')} |
				Booking: ${CONFIG.BOOKING_TIME.hour}:${String(CONFIG.BOOKING_TIME.minute).padStart(2, '0')}
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

	function formatTimeRemaining(milliseconds) {
		const totalSeconds = Math.floor(milliseconds / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) {
			return `${hours}h ${minutes}m ${seconds}s`;
		} else if (minutes > 0) {
			return `${minutes}m ${seconds}s`;
		} else {
			return `${seconds}s`;
		}
	}

	function updateCountdown() {
		if (!state.selectedSlot) return;

		const now = Date.now();

		// Determine which action is next
		if (state.prepTime && now < state.prepTime) {
			// Prep is upcoming
			const remaining = state.prepTime - now;
			updateStatus(
				'idle',
				`⏰ Preparing booking in ${formatTimeRemaining(remaining)}`,
			);
		} else if (state.bookingTime && now < state.bookingTime) {
			// Booking is upcoming (prep already happened or is happening)
			const remaining = state.bookingTime - now;
			if (state.status === 'ready') {
				updateStatus(
					'ready',
					`✅ Ready! Booking in ${formatTimeRemaining(remaining)}`,
				);
			} else {
				updateStatus('idle', `⏰ Booking in ${formatTimeRemaining(remaining)}`);
			}
		}
	}

	function startCountdown() {
		// Clear any existing countdown
		if (state.countdownInterval) {
			clearInterval(state.countdownInterval);
		}

		// Update immediately
		updateCountdown();

		// Update every second
		state.countdownInterval = setInterval(updateCountdown, 1000);
	}

	function stopCountdown() {
		if (state.countdownInterval) {
			clearInterval(state.countdownInterval);
			state.countdownInterval = null;
		}
	}

	function resetState() {
		// Clear selection
		state.selectedSlot = null;
		state.availableSlots = [];
		state.hasFoundSlots = false;

		// Clear timers
		if (state.prepTimer) clearTimeout(state.prepTimer);
		if (state.bookingTimer) clearTimeout(state.bookingTimer);
		if (state.scanInterval) clearInterval(state.scanInterval);
		stopCountdown();

		// Clear scheduled times
		state.prepTime = null;
		state.bookingTime = null;
		state.scanInterval = null;

		// Reset UI
		renderSlots();
		updateStatus('idle', 'Scanning for slots...');
	}

	function renderSlots() {
		const slotsContainer = document.getElementById('sa-slots');
		if (!slotsContainer) return;

		if (state.availableSlots.length === 0) {
			slotsContainer.className = 'sa-slots one-column';
			slotsContainer.innerHTML =
				'<div class="sa-empty">No slots detected. Select a day to see available slots.</div>';
			return;
		}

		// Organize slots by time and type (indoor/outdoor)
		const slotsByTime = {};
		let hasIndoor = false;
		let hasOutdoor = false;

		state.availableSlots.forEach((slot) => {
			const time = slot.time;
			const isIndoor = slot.title.toLowerCase().includes('indoor');
			const isOutdoor = slot.title.toLowerCase().includes('outdoor');

			if (isIndoor) hasIndoor = true;
			if (isOutdoor) hasOutdoor = true;

			if (!slotsByTime[time]) {
				slotsByTime[time] = { indoor: null, outdoor: null };
			}

			if (isIndoor) {
				slotsByTime[time].indoor = slot;
			} else if (isOutdoor) {
				slotsByTime[time].outdoor = slot;
			}
		});

		// Determine layout
		const twoColumns = hasIndoor && hasOutdoor;
		slotsContainer.className = twoColumns
			? 'sa-slots two-columns'
			: 'sa-slots one-column';

		// Sort times
		const times = Object.keys(slotsByTime).sort();

		// Build HTML
		let html = '';
		times.forEach((time) => {
			const slots = slotsByTime[time];
			const slotIndex = (slot) =>
				state.availableSlots.findIndex((s) => s === slot);

			if (twoColumns) {
				// Two column layout: Indoor | Outdoor
				const indoorSlot = slots.indoor;
				const outdoorSlot = slots.outdoor;

				if (indoorSlot) {
					html += `
						<div class="sa-slot ${state.selectedSlot === indoorSlot ? 'selected' : ''}" data-slot-index="${slotIndex(indoorSlot)}">
							<div class="sa-slot-time">${indoorSlot.time}</div>
							<div class="sa-slot-title">${indoorSlot.title}</div>
						</div>
					`;
				} else {
					html += '<div class="sa-slot-empty"></div>';
				}

				if (outdoorSlot) {
					html += `
						<div class="sa-slot ${state.selectedSlot === outdoorSlot ? 'selected' : ''}" data-slot-index="${slotIndex(outdoorSlot)}">
							<div class="sa-slot-time">${outdoorSlot.time}</div>
							<div class="sa-slot-title">${outdoorSlot.title}</div>
						</div>
					`;
				} else {
					html += '<div class="sa-slot-empty"></div>';
				}
			} else {
				// Single column layout
				const slot = slots.indoor || slots.outdoor;
				if (slot) {
					html += `
						<div class="sa-slot ${state.selectedSlot === slot ? 'selected' : ''}" data-slot-index="${slotIndex(slot)}">
							<div class="sa-slot-time">${slot.time}</div>
							<div class="sa-slot-title">${slot.title}</div>
						</div>
					`;
				}
			}
		});

		slotsContainer.innerHTML = html;

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
				console.log('Slot list changed, resetting state and rescanning...');

				// Clear selection and timers since content changed
				if (state.selectedSlot) {
					resetState();

					// Restart scanning
					state.scanInterval = setInterval(() => {
						if (!state.hasFoundSlots) {
							scanForSlots();
						}
					}, 2000);

					setTimeout(scanForSlots, 500);
				} else {
					// Just reset found flag if nothing was selected
					state.hasFoundSlots = false;
					scanForSlots();

					// Restart interval scanning if needed
					if (!state.scanInterval) {
						state.scanInterval = setInterval(() => {
							if (!state.hasFoundSlots) {
								scanForSlots();
							}
						}, 2000);
					}
				}
			});

			observer.observe(slotListContainer, {
				childList: true,
				subtree: true,
			});
		}

		// Also monitor day selector clicks using event delegation
		// This works even if buttons are dynamically added
		document.addEventListener('click', (event) => {
			const daySelectorButton = event.target.closest(
				CONFIG.SELECTORS.daySelectorButtons,
			);

			if (daySelectorButton) {
				console.log(
					'Day selector clicked, clearing all state and rescanning...',
				);

				// Use the reset function to clear everything
				resetState();

				// Start scanning again
				state.scanInterval = setInterval(() => {
					if (!state.hasFoundSlots) {
						scanForSlots();
					}
				}, 2000);

				setTimeout(scanForSlots, 500);
			}
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
		stopCountdown();

		const prepDelay = getTimeUntil(
			CONFIG.PREP_TIME.hour,
			CONFIG.PREP_TIME.minute,
		);
		const bookingDelay = getTimeUntil(
			CONFIG.BOOKING_TIME.hour,
			CONFIG.BOOKING_TIME.minute,
		);

		// Store the exact times
		state.prepTime = Date.now() + prepDelay;
		state.bookingTime = Date.now() + bookingDelay;

		// Schedule preparation
		state.prepTimer = setTimeout(() => {
			prepareBooking();
		}, prepDelay);

		// Schedule actual booking
		state.bookingTimer = setTimeout(() => {
			executeBooking();
		}, bookingDelay);

		// Start the countdown display
		startCountdown();

		console.log(
			`Booking scheduled - Prep in ${Math.round(prepDelay / 1000)}s, Book in ${Math.round(bookingDelay / 1000)}s`,
		);
	}

	function prepareBooking() {
		if (!state.selectedSlot) {
			updateStatus('error', 'No slot selected!');
			return;
		}

		updateStatus('preparing', '🔄 Preparing reservation...');

		// Click the reserve button to open the modal
		state.selectedSlot.button.click();

		// Wait for modal to appear, then fill it out
		setTimeout(() => {
			const modalDetails = findProductModalDetail();
			if (!modalDetails) {
				stopCountdown();
				updateStatus(
					'error',
					'❌ Could not find modal elements. Please check manually.',
				);
				return;
			}

			// Focus the select input (this may trigger any necessary validation)
			modalDetails.selectInput.focus();

			// The countdown will automatically update to show booking countdown
			state.status = 'ready';
			updateCountdown();
		}, 1000);
	}

	function executeBooking() {
		if (!state.selectedSlot) {
			updateStatus('error', '❌ No slot selected!');
			return;
		}

		stopCountdown();
		updateStatus('booking', '🚀 Executing booking NOW!');

		const modalDetails = findProductModalDetail();
		if (!modalDetails) {
			updateStatus(
				'error',
				'❌ Could not find modal book button. Please complete manually!',
			);
			return;
		}

		// Click the booking button
		modalDetails.button.click();

		// Give feedback
		setTimeout(() => {
			updateStatus(
				'success',
				`🎉 Booking executed for ${state.selectedSlot.time}! Check if successful.`,
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
