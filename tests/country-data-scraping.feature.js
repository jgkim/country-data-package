import chai, { expect } from 'chai';
import dirtyChai from 'dirty-chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import _ from 'lodash';
import Scraper from '../scripts/Scraper';

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

        const korea = _.find(countries, { isoTwoLetterCountryCode: 'KR' });
        expect(korea.englishShortName).to.equal('Korea (Republic of)');
        expect(korea.isoThreeLetterCountryCode).to.equal('KOR');
        expect(korea.isoThreeDigitCountryCode).to.equal('410');
        expect(korea.isoCountrySubdivisionCode).to.equal('ISO 3166-2:KR');
        expect(korea.wikipediaSlug).to.equal('Korea_(Republic_of)');

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
