// ==UserScript==
// @name         Sportkot Automator
// @namespace    https://usc.kuleuven.cloud/products/bookable-product-schedule
// @version      2025-11-05
// @description  Automates booking on Sportkot Bookable Timeslots
// @author       Dieter Luypaert
// @match        https://usc.kuleuven.cloud/products/bookable-product-schedule*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
	'use strict';

	const CONFIG = {
		PREP_TIME: { hour: 8, minute: 59 },
		BOOKING_TIME: { hour: 9, minute: 0 },
		FIELD_OPTIONS: {
			indoor: [1, 2, 3],
			outdoor: [1, 2, 3, 4, 5],
		},
		SELECTORS: {
			daySelectorButtons: 'day-selector .btn[data-test-id-day-selector]',
			bookableSlotList: 'bookable-slot-list',
			bookableSlot: 'bookable-slot-list div[data-test-id="bookable-slot-list"]',
			slotTime: '[data-test-id="bookable-slot-start-time"]',
			slotTitle: '[data-test-id="bookable-slot-linked-product-description"]',
			slotButton: '.btn',
			modalContainer: 'modal-container .modal-content',
			modalProductSelect: 'product-select-input input',
			modalBookButton: '.btn[data-test-id=details-book-button]',
		},
	};

	const state = {
		selectedSlot: null,
		availableSlots: [],
		status: 'idle',
		prepTimer: null,
		bookingTimer: null,
		scanInterval: null,
		hasFoundSlots: false,
		countdownInterval: null,
		prepTime: null,
		bookingTime: null,
		selectedDate: null,
		canBookImmediately: false,
		selectedIndoorField: null,
		selectedOutdoorField: null,
		timeCheckInterval: null,
	};

	/**
	 * @returns {{selectInput: HTMLInputElement, button: HTMLButtonElement}|undefined}
	 */
	function findProductModalDetail() {
		const selectInput = document.querySelector(
			CONFIG.SELECTORS.modalProductSelect,
		);
		const button = document.querySelector(CONFIG.SELECTORS.modalBookButton);
		if (!selectInput || !button) {
			return;
		}
		return { selectInput, button };
	}

	/**
	 * @param {number} fieldNumber
	 * @returns {Promise<boolean>}
	 */
	function selectFieldInModal(fieldNumber) {
		return new Promise((resolve) => {
			console.log(
				`[Field Selection] Starting selection for field ${fieldNumber}`,
			);

			// Find the modal using the configured selector
			const modal = document.querySelector(CONFIG.SELECTORS.modalContainer);

			if (!modal) {
				console.error('[Field Selection] Could not find modal');
				console.log(
					'[Field Selection] Tried selector:',
					CONFIG.SELECTORS.modalContainer,
				);
				resolve(false);
				return;
			}

			console.log('[Field Selection] Found modal');

			const ngSelect = modal.querySelector('ng-select');
			if (!ngSelect) {
				console.error('[Field Selection] Could not find ng-select in modal');
				resolve(false);
				return;
			}

			// Find and click the ng-select container to open dropdown
			const ngSelectContainer = ngSelect.querySelector('.ng-select-container');
			if (!ngSelectContainer) {
				console.error('[Field Selection] Could not find ng-select-container');
				resolve(false);
				return;
			}

			console.log('[Field Selection] Opening dropdown...');

			// Try multiple methods to open the Angular dropdown
			// Method 1: Native click event
			const clickEvent = new MouseEvent('click', {
				bubbles: true,
				cancelable: true,
				view: window,
			});
			ngSelectContainer.dispatchEvent(clickEvent);

			// Method 2: Also try clicking on the arrow/icon if it exists
			const arrowIcon = ngSelect.querySelector('.ng-arrow-wrapper');
			if (arrowIcon) {
				arrowIcon.click();
				arrowIcon.dispatchEvent(clickEvent);
			}

			// Method 3: Try mousedown event which ng-select sometimes uses
			const mousedownEvent = new MouseEvent('mousedown', {
				bubbles: true,
				cancelable: true,
				view: window,
			});
			ngSelectContainer.dispatchEvent(mousedownEvent);

			// Wait for dropdown to open and populate
			setTimeout(() => {
				// Look for options in the dropdown panel
				// ng-dropdown-panel might be outside the ng-select element
				let dropdownPanel = ngSelect.querySelector('ng-dropdown-panel');
				if (!dropdownPanel) {
					// Try searching in the entire document
					dropdownPanel = document.querySelector('ng-dropdown-panel');
				}

				if (!dropdownPanel) {
					console.error('[Field Selection] Dropdown panel not found');
					console.log('[Field Selection] Trying to check ng-select state...');
					console.log(
						'[Field Selection] ng-select classes:',
						ngSelect.className,
					);
					console.log(
						'[Field Selection] Is dropdown open?',
						ngSelect.classList.contains('ng-select-opened'),
					);
					resolve(false);
					return;
				}

				const options = dropdownPanel.querySelectorAll('.ng-option');
				console.log(
					`[Field Selection] Found ${options.length} dropdown options`,
				);

				if (options.length === 0) {
					console.warn('[Field Selection] No options found in dropdown');
					resolve(false);
					return;
				}

				// Match any text that contains the field number as a word
				// Pattern matches "Beachvolley 5", "Indoor Beachvolley 3", etc.
				const fieldPattern = new RegExp(`\\b${fieldNumber}\\b`);

				for (const option of options) {
					const optionText = option.textContent.trim();

					if (fieldPattern.test(optionText)) {
						console.log(`[Field Selection] ✓ Matched option: "${optionText}"`);

						// Click the option
						option.click();

						// Also dispatch mouse event for Angular
						const clickEvent = new MouseEvent('click', {
							bubbles: true,
							cancelable: true,
							view: window,
						});
						option.dispatchEvent(clickEvent);

						console.log('[Field Selection] Selection completed');
						resolve(true);
						return;
					}
				}

				console.warn(
					`[Field Selection] Could not find option with field number ${fieldNumber}`,
				);
				console.log(
					'[Field Selection] Available options:',
					Array.from(options).map((o) => o.textContent.trim()),
				);
				resolve(false);
			}, 400);
		});
	}

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
					max-height: min(700px, 95dvh);
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
				.sa-header-times {
					font-size: 10px;
					font-weight: normal;
					opacity: 0.7;
				}
				.sa-status {
					padding: 12px;
					border-top: 1px solid #ddd;
					border-radius: 0 0 6px 6px;
					font-size: 13px;
					display: flex;
					justify-content: space-between;
					align-items: center;
					gap: 16px;
				}
				.sa-status-text {
					flex: 1;
				}
				.sa-book-now-btn {
					background: #28a745;
					color: white;
					border: none;
					border-radius: 4px;
					padding: 6px 12px;
					font-size: 12px;
					font-weight: bold;
					cursor: pointer;
					transition: background 0.2s;
					white-space: nowrap;
				}
				.sa-book-now-btn.secondary {
					background: #6c757d;
					color: white;
				}
				.sa-book-now-btn.secondary:hover {
					background: #5a6268;
				}
				.sa-book-now-btn.secondary:active {
					background: #545b62;
				}
				.sa-book-now-btn:hover {
					background: #218838;
				}
				.sa-book-now-btn:active {
					background: #1e7e34;
				}
				.sa-book-now-btn:disabled {
					background: #6c757d;
					cursor: not-allowed;
					opacity: 0.6;
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
					border: 2px solid #ddd;
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
					border: 2px dashed #ddd;
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
				.sa-field-selector {
					padding: 12px;
					border-bottom: 1px solid #ddd;
					background: #f8f9fa;
					display: none;
				}
				.sa-field-selector.visible {
					display: block;
				}
				.sa-field-groups {
					display: flex;
					gap: 16px;
				}
				.sa-field-group {
					flex: 1;
				}
				.sa-field-group-header {
					font-size: 11px;
					font-weight: bold;
					color: #666;
					text-transform: uppercase;
					margin-bottom: 8px;
					padding-bottom: 4px;
					border-bottom: 2px solid #ddd;
				}
				.sa-field-options {
					display: flex;
					gap: 6px;
					flex-wrap: wrap;
				}
				.sa-field-option {
					background: white;
					border: 2px solid #ddd;
					border-radius: 4px;
					padding: 8px 12px;
					font-size: 13px;
					font-weight: bold;
					cursor: pointer;
					transition: all 0.2s;
					min-width: 60px;
					text-align: center;
				}
				.sa-field-option:hover {
					border-color: #007bff;
					background: #f0f8ff;
				}
				.sa-field-option.selected {
					background: #007bff;
					border-color: #007bff;
					color: white;
				}
			</style>
			<div class="sa-header">
				<span>🎯 Sportkot Automator</span>
				<span class="sa-header-times">prepare: ${CONFIG.PREP_TIME.hour}:${String(CONFIG.PREP_TIME.minute).padStart(2, '0')} | book: ${CONFIG.BOOKING_TIME.hour}:${String(CONFIG.BOOKING_TIME.minute).padStart(2, '0')}</span>
			</div>
			<div class="sa-field-selector" id="sa-field-selector">
				<div class="sa-field-groups" id="sa-field-groups"></div>
			</div>
			<div class="sa-slots" id="sa-slots">
				<div class="sa-empty">No slots detected. Select a day to see available slots.</div>
			</div>
			<div class="sa-status sa-status-idle" id="sa-status">
				<span class="sa-status-text">Status: Waiting for selection...</span>
			</div>
		`;

		document.body.appendChild(overlay);

		return overlay;
	}

	/**
	 * @param {string} status
	 * @param {string} message
	 * @param {boolean|string} [showBookNowButton=false]
	 */
	function updateStatus(status, message, showBookNowButton = false) {
		state.status = status;
		const statusEl = document.getElementById('sa-status');
		if (statusEl) {
			statusEl.className = `sa-status sa-status-${status}`;

			// Create status text element
			const textSpan =
				statusEl.querySelector('.sa-status-text') ||
				document.createElement('span');
			textSpan.className = 'sa-status-text';
			textSpan.textContent = message;

			// Clear and rebuild
			statusEl.innerHTML = '';
			statusEl.appendChild(textSpan);

			// Add "Book Now" button if requested
			if (showBookNowButton) {
				const bookNowBtn = document.createElement('button');
				bookNowBtn.className =
					showBookNowButton === 'secondary'
						? 'sa-book-now-btn secondary'
						: 'sa-book-now-btn';
				bookNowBtn.textContent = 'Book Now';
				bookNowBtn.onclick = bookNowManual;
				statusEl.appendChild(bookNowBtn);
			}
		}
	}

	/**
	 * @param {number} milliseconds
	 * @returns {string}
	 */
	function formatTimeRemaining(milliseconds) {
		const totalSeconds = Math.floor(milliseconds / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		const showSeconds = totalSeconds < 300;

		if (hours > 0) {
			if (showSeconds && hours === 0) {
				return `${minutes}m ${seconds}s`;
			}
			return `${hours}h ${minutes}m`;
		} else if (minutes > 0) {
			if (showSeconds) {
				return `${minutes}m ${seconds}s`;
			}
			return `${minutes}m`;
		} else {
			return `${seconds}s`;
		}
	}

	function updateCountdown() {
		if (!state.selectedSlot) return;
		if (state.canBookImmediately) return;

		const now = Date.now();

		if (state.prepTime && now < state.prepTime) {
			const remaining = state.prepTime - now;
			const prepDate = new Date(state.prepTime);
			const dateStr = prepDate.toLocaleDateString('en-US', {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			});
			updateStatus(
				'idle',
				`⏰ Preparing booking in ${formatTimeRemaining(remaining)} (at ${dateStr})`,
				'secondary',
			);
		} else if (state.bookingTime && now < state.bookingTime) {
			const remaining = state.bookingTime - now;
			if (state.status === 'ready') {
				updateStatus(
					'ready',
					`✅ Ready! Booking in ${formatTimeRemaining(remaining)}`,
					'secondary',
				);
			} else {
				updateStatus(
					'idle',
					`⏰ Booking in ${formatTimeRemaining(remaining)}`,
					'secondary',
				);
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

	/**
	 * @returns {number|null}
	 */
	function getSelectedFieldForSlot() {
		if (!state.selectedSlot) return null;

		const slotIsIndoor = state.selectedSlot.title
			.toLowerCase()
			.includes('indoor');

		return slotIsIndoor
			? state.selectedIndoorField
			: state.selectedOutdoorField;
	}

	function bookNowManual() {
		if (!state.selectedSlot) {
			updateStatus('error', '❌ No slot selected!');
			return;
		}

		const selectedField = getSelectedFieldForSlot();
		if (!selectedField) {
			const slotType = state.selectedSlot.title.toLowerCase().includes('indoor')
				? 'indoor'
				: 'outdoor';
			updateStatus('error', `❌ Please select an ${slotType} field first!`);
			return;
		}

		if (state.prepTimer) clearTimeout(state.prepTimer);
		if (state.bookingTimer) clearTimeout(state.bookingTimer);
		stopCountdown();

		console.log('Manual booking triggered!', {
			slot: state.selectedSlot,
			field: selectedField,
		});

		updateStatus('preparing', '🔄 Preparing booking...');

		state.selectedSlot.button.click();

		// Wait for modal to appear, then fill it out
		setTimeout(async () => {
			const modalDetails = findProductModalDetail();
			if (!modalDetails) {
				updateStatus(
					'error',
					'❌ Could not prepare booking. Please check manually.',
				);
				return;
			}

			// Select the field in the dropdown
			const fieldSelected = await selectFieldInModal(selectedField);

			if (!fieldSelected) {
				updateStatus(
					'error',
					'❌ Could not select field in dropdown. Please check manually.',
				);
				return;
			}

			updateStatus('ready', '✅ Ready! Executing booking...');

			// Wait a moment, then execute booking
			setTimeout(() => {
				updateStatus('booking', '🚀 Booking NOW!');

				const modalDetailsForBooking = findProductModalDetail();
				if (!modalDetailsForBooking) {
					updateStatus(
						'error',
						'❌ Could not complete booking. Please check manually!',
					);
					return;
				}

				// Click the booking button
				modalDetailsForBooking.button.click();

				// Give feedback
				setTimeout(() => {
					updateStatus(
						'success',
						`🎉 Booking completed for ${state.selectedSlot.time} (Field ${selectedField})! Check if successful.`,
					);
				}, 500);
			}, 1500); // Wait 1.5s between prep and booking
		}, 1000);
	}

	function resetState() {
		state.selectedSlot = null;
		state.availableSlots = [];
		state.hasFoundSlots = false;

		if (state.prepTimer) clearTimeout(state.prepTimer);
		if (state.bookingTimer) clearTimeout(state.bookingTimer);
		if (state.scanInterval) clearInterval(state.scanInterval);
		if (state.timeCheckInterval) clearInterval(state.timeCheckInterval);
		stopCountdown();
		stopTimeChecking();

		state.prepTime = null;
		state.bookingTime = null;
		state.scanInterval = null;
		state.timeCheckInterval = null;
		state.selectedDate = null;
		state.canBookImmediately = false;

		renderSlots();
		renderFieldSelector();
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

	/**
	 * @param {{button: HTMLButtonElement, time: string, title: string}} slot
	 */
	function selectSlot(slot) {
		state.selectedSlot = slot;
		renderSlots();
		scheduleBooking();
	}

	function renderFieldSelector() {
		const fieldSelector = document.getElementById('sa-field-selector');
		const fieldGroups = document.getElementById('sa-field-groups');

		if (!fieldSelector || !fieldGroups) return;

		// Check what types of slots are available
		const hasIndoor = state.availableSlots.some((slot) =>
			slot.title.toLowerCase().includes('indoor'),
		);
		const hasOutdoor = state.availableSlots.some((slot) =>
			slot.title.toLowerCase().includes('outdoor'),
		);

		if (!hasIndoor && !hasOutdoor) {
			// No slots available, hide field selector
			fieldSelector.classList.remove('visible');
			return;
		}

		// Build the field selector UI with separate indoor/outdoor groups
		let html = '';

		if (hasIndoor) {
			html += `
				<div class="sa-field-group">
					<div class="sa-field-group-header">Indoor</div>
					<div class="sa-field-options">
						${CONFIG.FIELD_OPTIONS.indoor
							.map(
								(num) => `
							<div class="sa-field-option ${state.selectedIndoorField === num ? 'selected' : ''}"
								data-field="${num}"
								data-field-type="indoor">
								Field ${num}
							</div>
						`,
							)
							.join('')}
					</div>
				</div>
			`;
		}

		if (hasOutdoor) {
			html += `
				<div class="sa-field-group">
					<div class="sa-field-group-header">Outdoor</div>
					<div class="sa-field-options">
						${CONFIG.FIELD_OPTIONS.outdoor
							.map(
								(num) => `
							<div class="sa-field-option ${state.selectedOutdoorField === num ? 'selected' : ''}"
								data-field="${num}"
								data-field-type="outdoor">
								Field ${num}
							</div>
						`,
							)
							.join('')}
					</div>
				</div>
			`;
		}

		fieldGroups.innerHTML = html;

		// Add click handlers
		fieldGroups.querySelectorAll('.sa-field-option').forEach((el) => {
			el.addEventListener('click', () => {
				const fieldNum = parseInt(el.dataset.field);
				const fieldType = el.dataset.fieldType;
				selectField(fieldNum, fieldType);
			});
		});

		// Show the field selector
		fieldSelector.classList.add('visible');
	}

	/**
	 * @param {number} fieldNum
	 * @param {string} fieldType
	 */
	function selectField(fieldNum, fieldType) {
		if (fieldType === 'indoor') {
			state.selectedIndoorField = fieldNum;
		} else {
			state.selectedOutdoorField = fieldNum;
		}
		renderFieldSelector();

		if (state.selectedSlot) {
			scheduleBooking();
		}
	}

	function scanForSlots() {
		const slotElements = document.querySelectorAll(
			CONFIG.SELECTORS.bookableSlot,
		);
		const slots = [];

		slotElements.forEach((element) => {
			const button = element.querySelector(CONFIG.SELECTORS.slotButton);
			const time = element
				.querySelector(CONFIG.SELECTORS.slotTime)
				?.textContent.trim();
			const title = element
				.querySelector(CONFIG.SELECTORS.slotTitle)
				?.textContent.trim();
			if (button && time && title) {
				slots.push({ button, time, title });
			}
		});

		state.availableSlots = slots;
		renderSlots();
		renderFieldSelector();

		if (slots.length > 0) {
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
			if (!state.hasFoundSlots) {
				updateStatus('idle', 'Scanning for slots...');
			}
		}
	}

	function setupSlotMonitoring() {
		updateStatus('idle', 'Scanning for slots...');

		scanForSlots();

		state.scanInterval = setInterval(() => {
			if (!state.hasFoundSlots) {
				console.log('Periodic scan for slots...');
				scanForSlots();
			}
		}, 2000);

		const slotListContainer = document.querySelector(
			CONFIG.SELECTORS.bookableSlotList,
		);

		if (slotListContainer) {
			const observer = new MutationObserver(() => {
				console.log('Slot list changed, resetting state and rescanning...');

				if (state.selectedSlot) {
					resetState();

					state.scanInterval = setInterval(() => {
						if (!state.hasFoundSlots) {
							scanForSlots();
						}
					}, 2000);

					setTimeout(scanForSlots, 500);
				} else {
					state.hasFoundSlots = false;
					scanForSlots();

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

		document.addEventListener('click', (event) => {
			const daySelectorButton = event.target.closest(
				CONFIG.SELECTORS.daySelectorButtons,
			);

			if (daySelectorButton) {
				console.log(
					'Day selector clicked, clearing all state and rescanning...',
				);

				resetState();

				state.scanInterval = setInterval(() => {
					if (!state.hasFoundSlots) {
						scanForSlots();
					}
				}, 2000);

				setTimeout(scanForSlots, 500);
			}
		});
	}

	/**
	 * @returns {Date}
	 */
	function getSelectedDate() {
		// Try to find the active day selector button
		const activeButton = document.querySelector(
			`${CONFIG.SELECTORS.daySelectorButtons}.active, ${CONFIG.SELECTORS.daySelectorButtons}[aria-pressed="true"], ${CONFIG.SELECTORS.daySelectorButtons}.btn-primary`,
		);

		if (activeButton) {
			// Try to extract date from data attributes
			const dateAttr = activeButton.getAttribute('data-date');
			if (dateAttr) {
				return new Date(dateAttr);
			}

			const buttonText = activeButton.textContent.trim();
			const dateMatch = buttonText.match(/(\d+)-(\d+)/);
			if (dateMatch) {
				const day = parseInt(dateMatch[1]);
				const month = parseInt(dateMatch[2]) - 1;
				const year = new Date().getFullYear();
				return new Date(year, month, day);
			}
		}

		console.warn('Could not determine selected date, defaulting to today');
		return new Date();
	}

	/**
	 * @returns {boolean}
	 */
	function canBookImmediately() {
		const now = new Date();
		const selectedDate = getSelectedDate();

		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);
		const selectedDay = new Date(
			selectedDate.getFullYear(),
			selectedDate.getMonth(),
			selectedDate.getDate(),
		);

		const currentHour = now.getHours();
		const currentMinute = now.getMinutes();
		const isPast9AM =
			currentHour > 9 || (currentHour === 9 && currentMinute >= 0);

		if (selectedDay.getTime() === today.getTime()) {
			return true;
		}

		if (selectedDay.getTime() === tomorrow.getTime() && isPast9AM) {
			return true;
		}

		return false;
	}

	/**
	 * @returns {Date}
	 */
	function getBookingOpenTime() {
		const selectedDate = getSelectedDate();
		const bookingOpenDate = new Date(selectedDate);
		bookingOpenDate.setDate(bookingOpenDate.getDate() - 1);
		bookingOpenDate.setHours(9, 0, 0, 0);

		return bookingOpenDate;
	}

	/**
	 * Checks if scheduled times have passed (handles sleep/wake recovery)
	 */
	function checkScheduledTimes() {
		if (!state.selectedSlot) return;
		if (state.canBookImmediately) return;
		if (state.status === 'success' || state.status === 'error') return;

		const now = Date.now();

		if (state.bookingTime && now >= state.bookingTime) {
			if (state.status !== 'booking' && state.status !== 'ready') {
				console.warn(
					'⚠️ Booking time passed! Executing now (recovered from sleep/throttle)',
				);
				if (state.prepTimer) clearTimeout(state.prepTimer);
				if (state.bookingTimer) clearTimeout(state.bookingTimer);
				executeBooking();
			}
			return;
		}

		if (state.prepTime && now >= state.prepTime) {
			if (state.status === 'idle') {
				console.warn(
					'⚠️ Prep time passed! Preparing now (recovered from sleep/throttle)',
				);
				if (state.prepTimer) clearTimeout(state.prepTimer);
				prepareBooking();
			}
		}
	}

	/**
	 * Start periodic time checking (20 second intervals for sleep/wake safety net)
	 */
	function startTimeChecking() {
		if (state.timeCheckInterval) {
			clearInterval(state.timeCheckInterval);
		}

		state.timeCheckInterval = setInterval(checkScheduledTimes, 20000);
		checkScheduledTimes();
	}

	function stopTimeChecking() {
		if (state.timeCheckInterval) {
			clearInterval(state.timeCheckInterval);
			state.timeCheckInterval = null;
		}
	}

	function scheduleBooking() {
		if (!state.selectedSlot) {
			console.log('No slot selected, cannot schedule');
			return;
		}

		const selectedField = getSelectedFieldForSlot();
		if (!selectedField) {
			if (state.prepTimer) clearTimeout(state.prepTimer);
			if (state.bookingTimer) clearTimeout(state.bookingTimer);
			stopCountdown();
			stopTimeChecking();

			state.prepTime = null;
			state.bookingTime = null;

			const slotType = state.selectedSlot.title.toLowerCase().includes('indoor')
				? 'indoor'
				: 'outdoor';
			updateStatus('idle', `⚠️ Please select an ${slotType} field`);
			return;
		}

		if (state.prepTimer) clearTimeout(state.prepTimer);
		if (state.bookingTimer) clearTimeout(state.bookingTimer);
		stopCountdown();
		stopTimeChecking();

		state.selectedDate = getSelectedDate();
		state.canBookImmediately = canBookImmediately();

		if (state.canBookImmediately) {
			updateStatus('idle', `✅ Ready to book`, true);
			console.log('Booking available immediately');
		} else {
			const bookingOpenTime = getBookingOpenTime();
			const now = Date.now();
			const prepDelay = bookingOpenTime.getTime() - 60000 - now;
			const bookingDelay = bookingOpenTime.getTime() - now;

			state.prepTime = now + prepDelay;
			state.bookingTime = now + bookingDelay;

			state.prepTimer = setTimeout(() => {
				prepareBooking();
			}, prepDelay);

			state.bookingTimer = setTimeout(() => {
				executeBooking();
			}, bookingDelay);

			startCountdown();
			startTimeChecking();

			const bookingDate = new Date(state.bookingTime);
			console.log(
				`Booking scheduled for ${bookingDate.toLocaleString()} - Prep in ${Math.round(prepDelay / 1000)}s, Book in ${Math.round(bookingDelay / 1000)}s`,
			);
		}
	}

	function prepareBooking() {
		if (!state.selectedSlot) {
			updateStatus('error', '❌ No slot selected!');
			return;
		}

		const selectedField = getSelectedFieldForSlot();
		if (!selectedField) {
			const slotType = state.selectedSlot.title.toLowerCase().includes('indoor')
				? 'indoor'
				: 'outdoor';
			updateStatus('error', `❌ Please select an ${slotType} field first!`);
			return;
		}

		updateStatus('preparing', '🔄 Preparing booking...');

		// Click the reserve button to open the modal
		state.selectedSlot.button.click();

		// Wait for modal to appear, then fill it out
		setTimeout(async () => {
			const modalDetails = findProductModalDetail();
			if (!modalDetails) {
				stopCountdown();
				updateStatus(
					'error',
					'❌ Could not prepare booking. Please check manually.',
				);
				return;
			}

			// Select the field in the dropdown
			const fieldSelected = await selectFieldInModal(selectedField);

			if (!fieldSelected) {
				stopCountdown();
				updateStatus(
					'error',
					'❌ Could not select field in dropdown. Please check manually.',
				);
				return;
			}

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
		updateStatus('booking', '🚀 Booking NOW!');

		const modalDetails = findProductModalDetail();
		if (!modalDetails) {
			updateStatus(
				'error',
				'❌ Could not complete booking. Please check manually!',
			);
			return;
		}

		// Click the booking button
		modalDetails.button.click();

		// Give feedback
		setTimeout(() => {
			updateStatus(
				'success',
				`🎉 Booking completed for ${state.selectedSlot.time}! Check if successful.`,
			);
		}, 500);
	}

	function init() {
		console.log('Sportkot Automator: Initializing...');

		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', init);
			return;
		}

		createOverlay();
		setupSlotMonitoring();

		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') {
				console.log('Tab became visible - checking scheduled times...');
				checkScheduledTimes();
			}
		});

		console.log('Sportkot Automator: Ready!');
	}

	init();
})();
