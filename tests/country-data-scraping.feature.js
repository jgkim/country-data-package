import chai, { expect } from 'chai';
import dirtyChai from 'dirty-chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import _ from 'lodash';
import Scraper from '../scripts/scraper.js';

chai.use(dirtyChai);
chai.use(sinonChai);

Feature('Country Data Scraping',
  'As a data consumer',
  'I want to scrape data about countries from the Web',
  'so that I can re-use the data for other purposes', () => {
    let scraper;
    let callback;

    beforeEach(() => {
      scraper = new Scraper();
    });

    Scenario('Good Network Connection', () => {
      Given('the network connection is okay', () => {
        if (!nock.isActive()) nock.activate();
        nock('https://en.wikipedia.org')
          .get('/wiki/ISO_3166-1')
          .replyWithFile(200, `${__dirname}/fixtures/ISO_3166-1.html`);
      });

      When('the data consumer starts scraping', (done) => {
        callback = sinon.spy((error) => { done(error); });
        scraper.getCountries(callback);
      });

      Then('data about countries will be returned', () => {
        const countries = callback.getCall(0).args[1];
        expect(countries).to.have.length.of.at.least(3);

        const korea = _.find(countries, { iso_3166_1_alpha_2: 'KR' });
        expect(korea.english_short_name).to.equal('Korea (Republic of)');
        expect(korea.iso_3166_1_alpha_3).to.equal('KOR');
        expect(korea.iso_3166_1_numeric).to.equal('410');
        expect(korea.iso_3166_2).to.equal('ISO 3166-2:KR');
        expect(korea.dbpedia_url).to.equal('http://dbpedia.org/resource/Korea_(Republic_of)');
        expect(korea.wikipedia_iso_3166_2_url).to.equal('https://en.wikipedia.org/wiki/ISO_3166-2:KR');

        nock.cleanAll();
        nock.restore();
      });
    });

    Scenario('Bad Network Connection', () => {
      Given('the network connection is refused', () => {
        if (!nock.isActive()) nock.activate();
        nock('https://en.wikipedia.org')
          .get('/wiki/ISO_3166-1')
          .replyWithError('Connection refused');
      });

      When('the data consumer starts scraping', (done) => {
        callback = sinon.spy(() => { done(); });
        scraper.getCountries(callback);
      });

      Then('an error will be returned', () => {
        expect(callback).to.have.been.calledWith(sinon.match.instanceOf(Error), []);
        expect(callback).to.have.been.calledWith(sinon.match.has('message', 'Connection refused'));

        nock.cleanAll();
        nock.restore();
      });
    });
  });
