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

	// const daySelectorButtonElements = document.querySelectorAll(
	// 	'day-selector .btn[data-test-id-day-selector]',
	// );
	const bookableSlotElements = document.querySelectorAll(
		'bookable-slot-list div[data-test-id="bookable-slot-list"]',
	);

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
		const button = bookableSlotElement.querySelector('.btn');
		const time = bookableSlotElement
			.querySelector('[data-test-id="bookable-slot-start-time"]')
			?.textContent.trim();
		const title = bookableSlotElement
			.querySelector(
				'[data-test-id="bookable-slot-linked-product-description"]',
			)
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
		const selectInput = document.querySelector('product-select-input input');
		const button = document.querySelector(
			'.btn[data-test-id=details-book-button]',
		);
		if (!selectInput || !button) {
			console.log('Missing elements:', { selectInput, button });
			return;
		}
		return { selectInput, button };
	}
})();
