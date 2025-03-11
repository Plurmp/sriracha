import Row from '../row';
import { Message } from 'discord.js';
import axios, { AxiosResponse } from 'axios';
import { fetchEHApi, fetchChestApi } from './api';
const JSSoup = require('jssoup').default;

export default async function fetchThumbnail(message: Message, row: Row) {
	return new Promise<void>((resolve, reject) => {
		if (!row?.eh?.match(/e-hentai/) && !row?.nh?.match(/fakku|nhentai/) && !row?.im?.match(/imgchest/)) {
			// not mainstream site. cannot fetch.
			reject('Bad image source');
		}

		resolve();
	}).then(async () => {
		let imageLocation;

		if (row?.eh?.match(/e-hentai/)) {
			let pageUrl;

			if (row.eh.match(/\/s\/[0-9a-f]{10}\/\d+-\d+$/)) {
				// We are linking to a specific page, no need to use the API
				pageUrl = row.eh;
			} else {
				const pageData = axios.get(row.eh).then((resp: AxiosResponse) => {
					const respdata = resp?.data;
					if (!respdata) {
						throw new Error(`No response body found.`);
					}
	
					return respdata;
				});

				const pageBody = await pageData;
				const pageSoup = new JSSoup(pageBody);

				const imageMatch = pageSoup
				.findAll("a")
				.filter((s: { attrs: { href: string; }; }) => s?.attrs?.href?.match(/\/s\/[0-9a-f]{10}\/\d+-1$/))[0];

				pageUrl = imageMatch['attrs']['href'];
			}

			const response = axios.get(pageUrl).then((resp: AxiosResponse) => {
				const respdata = resp?.data;
				if (!respdata) {
					throw new Error(`No response body found.`);
				}

				return respdata;
			});

			const body = await response;
			const soup = new JSSoup(body);

			const image = soup
				.findAll("img")
				.filter((s: { attrs: { id: string; }; }) => s?.attrs?.id === 'img')[0];

			imageLocation = image['attrs']['src'];
		} else if (row?.im?.match(/imgchest/)) {
			const resp = await fetchChestApi(row.im);
			imageLocation = resp.images[0].link;
		} else if (row?.nh?.match(/nhentai\.net\/g\/\d{1,6}\/\d+/)) {
			/*
			message.channel.send("nhentai seems to be the only option for link fetching, and it's no longer supported due to Cloudflare. Add alternate links or manually set the image with -img.");
			throw new Error('Attempted to fetch cover from nhentai');
			*/
			const resp = (await axios.get(row.nh)).data.match(/(?<link>https:\/\/i\.nhentai\.net\/galleries\/\d+\/\d+\..{3})/);

			if (typeof resp?.groups?.link === 'undefined') {
				message.channel.send('Unable to fetch cover image. Try linking the cover image with the -img tag.');
				throw new Error(`Unable to fetch cover image for \`${row.nh}\``);
			}

			imageLocation = resp.groups.link;
		} else if (row?.nh?.match(/nhentai/)) {
			/*
			message.channel.send("nhentai seems to be the only option for link fetching, and it's no longer supported due to Cloudflare. Add alternate links or manually set the image with -img.");
			throw new Error('Attempted to fetch cover from nhentai');
			*/
			const resp = (await axios.get(row.nh)).data.match(/(?<link>https:\/\/t\d?\.nhentai\.net\/galleries\/\d+\/cover\..{3})/);

			if (typeof resp?.groups?.link === 'undefined') {
				message.channel.send('Unable to fetch cover image. Try linking the cover image with the -img tag.');
				throw new Error(`Unable to fetch cover image for \`${row.nh}\``);
			}

			imageLocation = resp.groups.link;
		} else if (row?.nh?.match(/fakku\.net/)) {
			const resp = (await axios.get(row.nh).catch(() => {
				console.log("Uh oh stinky");
			}))?.data;
	
			if (!resp) {
				message.channel.send('Unable to fetch FAKKU cover image. Try linking with -img.');
				throw new Error(`Unable to fetch cover image for \`${row.nh}\``);
			}

			const imageLink = resp.match(/(?<link>https?:\/\/t\.fakku\.net.*?thumb\..{3})/);

			if (typeof imageLink?.groups?.link === 'undefined') {
				message.channel.send('Unable to fetch FAKKU cover image. Try linking the cover image with the -img tag.');
				throw new Error(`Unable to fetch cover image for \`${row.nh}\``);
			}

			imageLocation = imageLink.groups.link;
		} else {
			message.channel.send('dont use alternative sources idot');
			throw new Error('Bad image source: `' + row.nh + '`');
		}

		if (imageLocation) {
			return imageLocation;
		} else {
			throw new Error('Unable to fetch cover image');
		}
	});
}
