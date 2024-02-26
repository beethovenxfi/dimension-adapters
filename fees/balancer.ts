import { Adapter } from "../adapters/types";
import { CHAIN }from "../helpers/chains";
import { request, gql } from "graphql-request";
import type { ChainEndpoints } from "../adapters/types"
import { Chain } from '@defillama/sdk/build/general';
import { getBlock } from "../helpers/getBlock";
import { ChainBlocks } from "../adapters/types";
import BigNumber from "bignumber.js";
import { getTimestampAtStartOfPreviousDayUTC, getTimestampAtStartOfDayUTC } from "../utils/date";

const v1Endpoints = {
  [CHAIN.ETHEREUM]:
    "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer",
}

const v2Endpoints = {
  [CHAIN.ETHEREUM]:
    "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-v2-beta",
  [CHAIN.ARBITRUM]:
    "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-arbitrum-v2",
  [CHAIN.POLYGON]:
    "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-polygon-v2",
  [CHAIN.AVAX]:
    "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-avalanche-v2",
  [CHAIN.XDAI]:
    "https://api.thegraph.com/subgraphs/name/balancer-labs/balancer-gnosis-chain-v2",
  [CHAIN.BASE]:
    "https://api.studio.thegraph.com/query/24660/balancer-base-v2/version/latest",
  [CHAIN.POLYGON_ZKEVM]:
    "https://api.studio.thegraph.com/query/24660/balancer-polygon-zk-v2/version/latest",
};

const v1Graphs = (graphUrls: ChainEndpoints) => {
  return (chain: Chain) => {
    return async (timestamp: number, chainBlocks: ChainBlocks) => {
      const todaysTimestamp = getTimestampAtStartOfDayUTC(timestamp)
      const yesterdaysTimestamp = getTimestampAtStartOfPreviousDayUTC(timestamp)

      const todaysBlock = (await getBlock(todaysTimestamp, chain, chainBlocks));
      const yesterdaysBlock = (await getBlock(yesterdaysTimestamp, chain, {}));

      const graphQuery = gql
        `{
        today: balancer(id: "1", block: { number: ${todaysBlock} }) {
          totalSwapFee
        }
        yesterday: balancer(id: "1", block: { number: ${yesterdaysBlock} }) {
          totalSwapFee
        }
      }`;

      const graphRes = await request(graphUrls[chain], graphQuery);
      const dailyFee = (new BigNumber(graphRes["today"]["totalSwapFee"]).minus(new BigNumber(graphRes["yesterday"]["totalSwapFee"])))

      return {
        timestamp,
        totalFees: graphRes["today"]["totalSwapFee"],
        dailyFees: dailyFee.toString(),
        totalUserFees: graphRes["today"]["totalSwapFee"],
        dailyUserFees: dailyFee.toString(),
        totalRevenue: "0",
        dailyRevenue: "0",
        totalProtocolRevenue: "0",
        dailyProtocolRevenue: "0",
        totalSupplySideRevenue: graphRes["today"]["totalSwapFee"],
        dailySupplySideRevenue: dailyFee.toString(),
      };
    };
  };
};
interface IBalancer {
  id: string;
  totalProtocolFee: string;
}

interface IBalancerSnapshot {
  today: IBalancer[];
  yesterday: IBalancer[];
  tenPcFeeChange: {
    totalProtocolFee: string;
    timestamp: number;
  }
  fiftyPcFeeChange: {
    totalSwapFee: string;
    timestamp: number;
  }
}

const v2Graphs = (graphUrls: ChainEndpoints) => {
  return (chain: Chain) => {
    return async (timestamp: number) => {
      const startTimestamp = getTimestampAtStartOfDayUTC(timestamp)
      const fromTimestamp = startTimestamp - 60 * 60 * 24
      const toTimestamp = startTimestamp
      const graphQuery = gql
      `query fees {
        today:balancerSnapshots(where: {timestamp:${toTimestamp}, totalProtocolFee_gt:0, vault: "2"}, orderBy:totalProtocolFee, orderDirection: desc) {
          id
          totalProtocolFee
        }
        yesterday:balancerSnapshots(where: {timestamp:${fromTimestamp}, totalProtocolFee_gt:0, vault: "2"}, orderBy:totalProtocolFee, orderDirection: desc) {
          id
          totalProtocolFee
        }
        tenPcFeeChange: balancerSnapshot(id: "2-18972") {
          totalProtocolFee
          timestamp
        }
        fiftyPcFeeChange: balancerSnapshot(id: "2-19039") {
          totalProtocolFee
          timestamp
        }
      }`;

      const graphRes: IBalancerSnapshot = await request(graphUrls[chain], graphQuery);
      const dailyRevenue = new BigNumber(graphRes["today"][0]["totalProtocolFee"]).minus(new BigNumber(graphRes["yesterday"][0]["totalProtocolFee"]));

      let tenPcFeeTimestamp = 0
      let fiftyPcFeeTimestamp = 0

      if (chain === CHAIN.ETHEREUM || chain === CHAIN.POLYGON || chain === CHAIN.ARBITRUM) {
        tenPcFeeTimestamp = graphRes["tenPcFeeChange"]["timestamp"]
        fiftyPcFeeTimestamp = graphRes["fiftyPcFeeChange"]["timestamp"]
      }

      // 10% gov vote enabled: https://vote.balancer.fi/#/proposal/0xf6238d70f45f4dacfc39dd6c2d15d2505339b487bbfe014457eba1d7e4d603e3
      // 50% gov vote change: https://vote.balancer.fi/#/proposal/0x03e64d35e21467841bab4847437d4064a8e4f42192ce6598d2d66770e5c51ace
      const dailyFees = startTimestamp < tenPcFeeTimestamp ? "0" : (
        startTimestamp < fiftyPcFeeTimestamp ? dailyRevenue.multipliedBy(10) : dailyRevenue.multipliedBy(2))

      const dailyUserFees = startTimestamp < tenPcFeeTimestamp ? "0" : (
        startTimestamp < fiftyPcFeeTimestamp ? dailyRevenue.multipliedBy(9) : dailyRevenue)

      return {
        timestamp,
        // totalUserFees: currentTotalSwapFees.toString(),
        dailyUserFees: dailyUserFees.toString(),
        // totalFees: currentTotalSwapFees.toString(),
        dailyFees: dailyFees.toString(),
        // totalRevenue: dailyProtocolFee.toString(), // balancer v2 subgraph does not flash loan fees yet
        dailyRevenue: dailyRevenue.toString(), // balancer v2 subgraph does not flash loan fees yet
        // totalProtocolRevenue: totalRevenue.toString(),
        dailyProtocolRevenue: dailyRevenue.toString(),
        // totalSupplySideRevenue: currentTotalSwapFees.minus(totalRevenue.toString()).toString(),
        dailySupplySideRevenue: dailyUserFees.toString(),
      };
    };
  };
};

const methodology = {
  UserFees: "Trading fees paid by users, ranging from 0.0001% to 10%",
  Fees: "All trading fees collected (doesn't include withdrawal and flash loan fees)",
  Revenue: "Protocol revenue from all fees collected",
  ProtocolRevenue: "Set to 50% of collected fees by a governance vote",
  SupplySideRevenue: "A small percentage of the trade paid by traders to pool LPs, set by the pool creator or dynamically optimized by Gauntlet",
}

const adapter: Adapter = {
  breakdown: {
    v1: {
      [CHAIN.ETHEREUM]: {
        fetch: v1Graphs(v1Endpoints)(CHAIN.ETHEREUM),
        start: 1582761600,
        meta: {
          methodology: {
            UserFees: "Trading fees paid by users, ranging from 0.0001% and 10%",
            Fees: "All trading fees collected",
            Revenue: "Balancer V1 protocol fees are set to 0%",
            ProtocolRevenue: "Balancer V1 protocol fees are set to 0%",
            SupplySideRevenue: "Trading fees are distributed among LPs",
          }
        }
      },
    },
    v2: {
      [CHAIN.ETHEREUM]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.ETHEREUM),
        start: 1619136000,
        meta: {
          methodology
        }
      },
      [CHAIN.POLYGON]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.POLYGON),
        start: 1624492800,
        meta: {
          methodology
        }
      },
      [CHAIN.ARBITRUM]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.ARBITRUM),
        start: 1630368000,
        meta: {
          methodology
        }
      },
      [CHAIN.AVAX]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.AVAX),
        start: 1677283200,
        meta: {
          methodology
        }
      },
      [CHAIN.XDAI]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.XDAI),
        start: 1673308800,
        meta: {
          methodology
        }
      },
      [CHAIN.BASE]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.BASE),
        start: 1690329600,
        meta: {
          methodology
        }
      },
      [CHAIN.POLYGON_ZKEVM]: {
        fetch: v2Graphs(v2Endpoints)(CHAIN.POLYGON_ZKEVM),
        start: 1686614400,
        meta: {
          methodology
        }
      }
    }
  }
}

export default adapter;
