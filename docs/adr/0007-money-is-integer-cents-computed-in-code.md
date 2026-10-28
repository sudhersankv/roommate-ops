# Money is integer cents, and the model never does the math

Every amount is stored and computed as integer minor units (cents) in the Group's currency. The model passes amounts and split intent ("50/25/25", "I had the steak") to tools; Shares, Balances and Settle plans are always computed by services, and leftover cents are given out deterministically. The model only reports numbers that tools returned, so a balance in chat always matches the dashboard to the cent.
