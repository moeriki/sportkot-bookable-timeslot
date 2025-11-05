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

	const daySelectorButtonElements = document.querySelectorAll(
		'day-selector .btn[data-test-id-day-selector]',
	);
	const bookableSlotElements = document.querySelectorAll(
		'bookable-slot-list div[data-test-id="bookable-slot-list"]',
	);

	/**
	 * @param {HTMLElement} bookableSlotElement
	 * @return {string | undefined} time in format "HH:MM"
	 */
	function findBookableSlotTime(bookableSlotElement) {
		return bookableSlotElement
			.querySelector('[data-test-id="bookable-slot-start-time"]')
			?.textContent.trim();
	}

	/**
	 * @param {HTMLElement} bookableSlotElement
	 */
	function findBookableSlotReservationButtonElement(bookableSlotElement) {
		return bookableSlotElement.querySelector('.btn');
	}

	function findModalContentElement() {
		return document.querySelector('modal-container .modal-content');
	}

	/**
	 * @param {HTMLElement} root
	 */
	function findProductSelectInputElement(root) {
		return root.querySelector('product-select-input input');
	}

	/**
	 * @param {HTMLElement} root
	 */
	function findProductBookButtonElement(root) {
		return root.querySelector('.btn[data-test-id=details-book-button]');
	}
})();
