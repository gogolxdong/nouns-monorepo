import { Auction, AuctionHouseContractFunction } from '../../wrappers/nounsAuction';
import { useEthers, useContractFunction } from '@usedapp/core';
import { connectContractToSigner } from '@usedapp/core/dist/cjs/src/hooks';
import { useAppSelector } from '../../hooks';
import React, { useEffect, useState, useRef, ChangeEvent, useCallback } from 'react';
import { utils, BigNumber as EthersBN } from 'ethers';
import BigNumber from 'bignumber.js';
import classes from './Bid.module.css';
import { Spinner, InputGroup, FormControl, Button, Col, Accordion, Form } from 'react-bootstrap';
import { useAuctionMinBidIncPercentage } from '../../wrappers/nounsAuction';
import { useAppDispatch } from '../../hooks';
import { AlertModal, setAlertModal } from '../../state/slices/application';
import { NounsAuctionHouseFactory } from '@nouns/sdk';
import config from '../../config';
import WalletConnectModal from '../WalletConnectModal';
import SettleManuallyBtn from '../SettleManuallyBtn';
import { Trans } from '@lingui/macro';
import { useActiveLocale } from '../../hooks/useActivateLocale';
import responsiveUiUtilsClasses from '../../utils/ResponsiveUIUtils.module.css';
import clsx from 'clsx';


const computeMinimumNextBid = (
  currentBid: BigNumber,
  minBidIncPercentage: BigNumber | undefined,
): BigNumber => {
  if (!minBidIncPercentage) {
    return new BigNumber(0);
  }
  return currentBid
    .times(minBidIncPercentage.div(100).plus(1))
    .decimalPlaces(0, BigNumber.ROUND_UP);
};

const minBidEth = (minBid: BigNumber): string => {
  if (minBid.isZero()) {
    return '0.01';
  }

  const eth = utils.formatEther(EthersBN.from(minBid.toString()));
  return new BigNumber(eth).toFixed(2, BigNumber.ROUND_CEIL);
};

const currentBid = (bidInputRef: React.RefObject<HTMLInputElement>) => {
  if (!bidInputRef.current || !bidInputRef.current.value) {
    return new BigNumber(0);
  }
  return new BigNumber(utils.parseEther(bidInputRef.current.value).toString());
};

const Bid: React.FC<{
  auction: Auction;
  auctionEnded: boolean;
}> = props => {
  const activeAccount = useAppSelector(state => state.account.activeAccount);
  const { library } = useEthers();
  let { auction, auctionEnded } = props;
  const activeLocale = useActiveLocale();
  const nounsAuctionHouseContract = new NounsAuctionHouseFactory().attach(
    config.addresses.nounsAuctionHouseProxy,
  );

  const account = useAppSelector(state => state.account.activeAccount);

  const bidInputRef = useRef<HTMLInputElement>(null);

  const [bidInput, setBidInput] = useState('');

  const [showBigContent, setShowBigContent] = useState(false)

  const [bidButtonContent, setBidButtonContent] = useState({
    loading: false,
    content: auctionEnded ? <Trans>Settle</Trans> : <Trans>Place bid</Trans>,
  });

  const [showConnectModal, setShowConnectModal] = useState(false);

  const hideModalHandler = () => {
    setShowConnectModal(false);
  };

  const dispatch = useAppDispatch();
  const setModal = useCallback((modal: AlertModal) => dispatch(setAlertModal(modal)), [dispatch]);

  const minBidIncPercentage = useAuctionMinBidIncPercentage();
  const minBid = computeMinimumNextBid(
    auction && new BigNumber(auction.amount.toString()),
    minBidIncPercentage,
  );

  const { send: placeBid, state: placeBidState } = useContractFunction(
    nounsAuctionHouseContract,
    AuctionHouseContractFunction.createBid,
  );
  const { send: settleAuction, state: settleAuctionState } = useContractFunction(
    nounsAuctionHouseContract,
    AuctionHouseContractFunction.settleCurrentAndCreateNewAuction,
  );

  const bidInputHandler = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target.value;

    // disable more than 2 digits after decimal point
    if (input.includes('.') && event.target.value.split('.')[1].length > 2) {
      return;
    }

    setBidInput(event.target.value);
  };

  const placeBidHandler = async () => {
    if (!auction || !bidInputRef.current || !bidInputRef.current.value) {
      return;
    }

    if (currentBid(bidInputRef).isLessThan(minBid)) {
      setModal({
        show: true,
        title: <Trans>Insufficient bid amount 🤏</Trans>,
        message: (
          <Trans>
            Please place a bid higher than or equal to the minimum bid amount of {minBidEth(minBid)}{' '}
            ETH
          </Trans>
        ),
      });
      setBidInput(minBidEth(minBid));
      return;
    }

    const value = utils.parseEther(bidInputRef.current.value.toString());
    const contract = connectContractToSigner(nounsAuctionHouseContract, undefined, library);
    const gasLimit = await contract.estimateGas.createBid(auction.nounId, {
      value,
    });
    placeBid(auction.nounId, {
      value,
      gasLimit: gasLimit.add(10_000), // A 10,000 gas pad is used to avoid 'Out of gas' errors
    });
  };

  const settleAuctionHandler = () => {
    settleAuction();
  };

  const clearBidInput = () => {
    if (bidInputRef.current) {
      bidInputRef.current.value = '';
    }
  };

  // successful bid using redux store state
  useEffect(() => {
    if (!account) return;

    // tx state is mining
    const isMiningUserTx = placeBidState.status === 'Mining';
    // allows user to rebid against themselves so long as it is not the same tx
    const isCorrectTx = currentBid(bidInputRef).isEqualTo(new BigNumber(auction.amount.toString()));
    if (isMiningUserTx && auction.bidder === account && isCorrectTx) {
      placeBidState.status = 'Success';
      setModal({
        title: <Trans>Success</Trans>,
        message: <Trans>Bid was placed successfully!</Trans>,
        show: true,
      });
      setBidButtonContent({ loading: false, content: <Trans>Place bid</Trans> });
      clearBidInput();
    }
  }, [auction, placeBidState, account, setModal]);

  // placing bid transaction state hook
  useEffect(() => {
    switch (!auctionEnded && placeBidState.status) {
      case 'None':
        setBidButtonContent({
          loading: false,
          content: <Trans>Place bid</Trans>,
        });
        break;
      case 'Mining':
        setBidButtonContent({ loading: true, content: <></> });
        break;
      case 'Fail':
        setModal({
          title: <Trans>Transaction Failed</Trans>,
          message: placeBidState?.errorMessage || <Trans>Please try again.</Trans>,
          show: true,
        });
        setBidButtonContent({ loading: false, content: <Trans>Bid</Trans> });
        break;
      case 'Exception':
        setModal({
          title: <Trans>Error</Trans>,
          message: placeBidState?.errorMessage || <Trans>Please try again.</Trans>,
          show: true,
        });
        setBidButtonContent({ loading: false, content: <Trans>Bid</Trans> });
        break;
    }
  }, [placeBidState, auctionEnded, setModal]);

  // settle auction transaction state hook
  useEffect(() => {
    switch (auctionEnded && settleAuctionState.status) {
      case 'None':
        setBidButtonContent({
          loading: false,
          content: <Trans>Settle Auction</Trans>,
        });
        break;
      case 'Mining':
        setBidButtonContent({ loading: true, content: <></> });
        break;
      case 'Success':
        setModal({
          title: <Trans>Success</Trans>,
          message: <Trans>Settled auction successfully!</Trans>,
          show: true,
        });
        setBidButtonContent({ loading: false, content: <Trans>Settle Auction</Trans> });
        break;
      case 'Fail':
        setModal({
          title: <Trans>Transaction Failed</Trans>,
          message: settleAuctionState?.errorMessage || <Trans>Please try again.</Trans>,
          show: true,
        });
        setBidButtonContent({ loading: false, content: <Trans>Settle Auction</Trans> });
        break;
      case 'Exception':
        setModal({
          title: <Trans>Error</Trans>,
          message: settleAuctionState?.errorMessage || <Trans>Please try again.</Trans>,
          show: true,
        });
        setBidButtonContent({ loading: false, content: <Trans>Settle Auction</Trans> });
        break;
    }
  }, [settleAuctionState, auctionEnded, setModal]);

  if (!auction) return null;

  const isDisabled =
    placeBidState.status === 'Mining' || settleAuctionState.status === 'Mining' || !activeAccount;

  const fomoNounsBtnOnClickHandler = () => {
    // Open Fomo Nouns in a new tab
    window.open('https://fomonouns.wtf', '_blank')?.focus();
  };

  const isWalletConnected = activeAccount !== undefined;

  return (
    <>
      {showConnectModal && activeAccount === undefined && (
        <WalletConnectModal onDismiss={hideModalHandler} />
      )}
      { showBigContent && 
            <div>
              <div className={classes.maskBgBig}></div>
              <div className={classes.bigContentWrap}>
                <div className={classes.bigContent}>
                  <h1 className={classes.bigTitle}>Confirm Bid</h1>

                  {/* 右上角关闭按钮 */}
                  <svg onClick={() => setShowBigContent(false)} style={{ position: 'absolute', right: 28, top: 33, cursor: 'pointer' }} width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M15.8638 1L1.00012 15.8636" stroke="black" stroke-width="2" />
                    <path d="M15.8638 15.8638L1.00012 1.00012" stroke="black" stroke-width="2" />
                  </svg>


                  {/* 三个选项 */}
                  <div className={classes.selectedBox}>
                    <Form.Select className={classes.selectedItem} aria-label="Default select example">
                      <option>Votable</option>
                      <option value="1">One</option>
                      <option value="2">Two</option>
                      <option value="3">Three</option>
                    </Form.Select>
                    <Form.Select className={clsx(classes.selectedItem, classes.selectedItemCenter)} aria-label="Default select example">
                      <option>Select Plan Tems</option>
                      <option value="1">One</option>
                      <option value="2">Two</option>
                      <option value="3">Three</option>
                    </Form.Select>
                    <Form.Select className={classes.selectedItem} aria-label="Default select example">
                      <option>Select Down Payment</option>
                      <option value="1">One</option>
                      <option value="2">Two</option>
                      <option value="3">Three</option>
                    </Form.Select>
                  </div>


                  {/* Account Details */}
                  <div className={classes.accountInfo}>
                    <Accordion defaultActiveKey="1">
                      <Accordion.Item className={classes.accordionItem} style={{marginTop: 0, border: '1px solid #fff'}} eventKey="0">
                        <Accordion.Header>
                          <div className={classes.sideTitle}>
                            <span>Account Details</span>
                            <span>See Details</span>
                          </div>
                        </Accordion.Header>
                        <Accordion.Body>
                          <div className={classes.accountInfoLineWrap}>
                            <div className={classes.accountInfoLine}></div>
                          </div>
                          <div className={classes.transitionItem}>
                          <span>Votable</span>
                          <span>True</span>
                        </div>
                        <div className={classes.transitionItem}>
                          <span>Original Payment </span>
                          <span>30 E</span>
                        </div>
                        <div style={{height: 12}}></div>
                        </Accordion.Body>
                      </Accordion.Item>
                    </Accordion>
                    <div className={classes.accountInfoLineWrap}>
                      <div className={classes.accountInfoLine}></div>
                    </div>
                    <div className={classes.accountInfoItem}>
                      <span>Account Level</span>
                      <span>
                        Lv. 3 → Lv.3
                      </span>
                    </div>
                  </div>

                  {/* Transaction Details */}
                  <Accordion defaultActiveKey="0">
                    <Accordion.Item className={clsx(classes.accordionItem, classes.strongBorder)} eventKey="0">
                      <Accordion.Header>
                        <div className={classes.sideTitle}>
                          <span>Transaction Details</span>
                          <span>See Details</span>
                        </div>
                      </Accordion.Header>
                      <Accordion.Body>
                        <div className={classes.accountInfoLineWrap}>
                          <div className={classes.accountInfoLine}></div>
                        </div>
                        <div className={classes.transitionItem}>
                          <span>Votable</span>
                          <span>True</span>
                        </div>
                        <div className={classes.transitionItem}>
                          <span>Original Payment </span>
                          <span>30 E</span>
                        </div>
                        <div className={classes.transitionItem}>
                          <span>Interest Fee</span>
                          <span>3E <span style={{ color: '#767676' }}>(10%)</span></span>
                        </div>
                        <div className={classes.transitionItem}>
                          <span>Down Payment</span>
                          <span>6E <span style={{ color: '#767676' }}>(20%)</span></span>
                        </div>

                        <div className={classes.transitionItem}>
                          <span>Length of Plan</span>
                          <span>9 Months</span>
                        </div>
                        <div className={classes.transitionItem}>
                          <span>Monthly Payments</span>
                          <span>3 E</span>
                        </div>
                        <div style={{ fontWeight: 700, marginBottom: 16 }} className={classes.transitionItem}>
                          <span>Total Purchase Amount</span>
                          <span>33 E</span>
                        </div>
                      </Accordion.Body>
                    </Accordion.Item>
                  </Accordion>

                  {/* Attention */}
                  <div className={clsx(classes.accountInfo, classes.transitionDetail, classes.attention)}>
                    <span>Attention</span>
                    <div className={classes.attentionContent}>
                      <svg width="33" height="31" viewBox="0 0 23 21" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M11.497 0.954102C12.5567 0.954102 13.5257 1.51327 14.0783 2.43529L21.7778 15.2658C22.3514 16.2218 22.3817 17.4216 21.858 18.4055C21.3286 19.4033 20.3086 20.0288 19.1965 20.0288H3.79754C2.68536 20.0288 1.66537 19.4033 1.13661 18.4066C0.612352 17.4216 0.642584 16.2218 1.21619 15.2658L8.91542 2.43571C9.4683 1.51324 10.4374 0.954102 11.497 0.954102Z" fill="black" />
                        <path d="M11.4969 13.6865C12.1746 13.6865 12.7239 14.2586 12.7239 14.9644C12.7239 15.6702 12.1746 16.2424 11.4969 16.2424C10.8193 16.2424 10.27 15.6702 10.27 14.9644C10.27 14.2586 10.8193 13.6865 11.4969 13.6865ZM11.4969 7.18304C12.005 7.18304 12.4171 7.61234 12.4171 8.1415V11.7694C12.4171 12.2985 12.005 12.7278 11.4969 12.7278C10.9889 12.7278 10.5767 12.2985 10.5767 11.7694V8.1415C10.5767 7.61234 10.9889 7.18304 11.4969 7.18304Z" fill="white" />
                      </svg>

                      <p>
                        I Agree to the Above, and understand any missed payments will result in forfeit of the NFT and all paid amounts.
                      </p>
                    </div>
                  </div>

                  {/* 删除 disable 类名以恢复正常使用 */}
                  <Button className={clsx(classes.acceptBtn, isDisabled ? classes.disable : undefined)}>Accept</Button>
                </div>
              </div>
            </div>
          }
      <InputGroup>
        {!auctionEnded && (
          <>
            <span className={classes.customPlaceholderBidAmt}>
              {!auctionEnded && !bidInput ? (
                <>
                  Ξ {minBidEth(minBid)}{' '}
                  <span
                    className={
                      activeLocale === 'ja-JP' ? responsiveUiUtilsClasses.disableSmallScreens : ''
                    }
                  >
                    <Trans>or more</Trans>
                  </span>
                </>
              ) : (
                ''
              )}
            </span>
            <FormControl
              className={classes.bidInput}
              type="number"
              min="0"
              onChange={bidInputHandler}
              ref={bidInputRef}
              value={bidInput}
            />
          </>
        )}
        {!auctionEnded ? (
          <Button
            className={auctionEnded ? classes.bidBtnAuctionEnded : classes.bidBtn}
            // onClick={auctionEnded ? settleAuctionHandler : placeBidHandler}
            // disabled={isDisabled}
            onClick={() => setShowBigContent(true)}
          >
            {bidButtonContent.loading ? <Spinner animation="border" /> : bidButtonContent.content}
          </Button>
        ) : (
          <>
            <Col lg={12} className={classes.voteForNextNounBtnWrapper}>
              <Button className={classes.bidBtnAuctionEnded} onClick={fomoNounsBtnOnClickHandler}>
                <Trans>Vote for the next Noun</Trans> ⌐◧-◧
              </Button>
            </Col>
            {/* Only show force settle button if wallet connected */}
            {isWalletConnected && (
              <Col lg={12}>
                <SettleManuallyBtn settleAuctionHandler={settleAuctionHandler} auction={auction} />
              </Col>
            )}
          </>
        )}
      </InputGroup>
    </>
  );
};
export default Bid;
